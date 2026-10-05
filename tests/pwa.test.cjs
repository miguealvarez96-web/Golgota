const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function file(relative) { return path.join(__dirname, '..', relative); }
function read(relative) { return fs.readFileSync(file(relative), 'utf8'); }
function load(relative) {
  const filename = file(relative);
  const code = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  module._compile(code, filename);
  return module.exports;
}

const manifest = load('src/app/manifest.ts').default();
const layout = read('src/app/layout.tsx');
const offline = read('src/app/offline/page.tsx');
const pwaClient = read('src/components/pwa/pwa-client.tsx');
const serviceWorker = read('public/sw.js');
const middleware = read('src/middleware.ts');
const brand = read('src/components/layout/brand.tsx');
const nextConfig = read('next.config.mjs');
const macro = read('scripts/cerrar-bloque-pwa.ps1');

function pngSize(relative) {
  const bytes = fs.readFileSync(file(relative));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(relative) {
  const bytes = fs.readFileSync(file(relative));
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  throw new Error(`No se encontraron dimensiones JPEG en ${relative}`);
}

test('manifest PWA contiene identidad, arranque standalone y colores de marca', () => {
  assert.equal(manifest.name, 'Gólgota CrossFit');
  assert.equal(manifest.short_name, 'Gólgota');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#F6F8FB');
  assert.equal(manifest.theme_color, '#0A1D4A');
  assert.match(manifest.description, /Gólgota CrossFit/);
});

test('iconos declarados existen, tienen medidas correctas y variante maskable', () => {
  assert.deepEqual(jpegSize('images.jpg'), { width: 204, height: 204 });
  const expected = new Map([
    ['/icons/icon-192.png', { width: 192, height: 192 }],
    ['/icons/icon-512.png', { width: 512, height: 512 }],
    ['/icons/icon-maskable-512.png', { width: 512, height: 512 }],
  ]);
  for (const icon of manifest.icons) {
    assert.deepEqual(pngSize(`public${icon.src}`), expected.get(icon.src));
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.deepEqual(pngSize('public/icons/apple-touch-icon.png'), { width: 180, height: 180 });
  assert.deepEqual(pngSize('public/golgota-logo.png'), { width: 204, height: 204 });
  assert.match(brand, /src="\/golgota-logo\.png"/);
  assert.match(layout, /url: "\/favicon\.ico"/);
});

test('metadata global usa APIs de Next 14 sin duplicar viewport', () => {
  const metadataSection = layout.match(/export const metadata:[\s\S]*?(?=export const viewport:)/)[0];
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /appleWebApp:[\s\S]*capable: true/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /export const viewport: Viewport[\s\S]*themeColor: "#0A1D4A"/);
  assert.doesNotMatch(metadataSection, /viewport:/);
});

test('service worker nunca persiste navegación autenticada y limita cache a assets públicos', () => {
  assert.match(serviceWorker, /request\.mode === "navigate"[\s\S]*fetch\(request, \{ cache: "no-store" \}\)[\s\S]*caches\.match\("\/offline"\)/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(serviceWorker, /if \(!isPublicAsset\) return/);
  assert.doesNotMatch(serviceWorker, /(?:pagos|saldos|clientes|supabase|localStorage)/i);
  assert.match(nextConfig, /source: "\/sw\.js"[\s\S]*no-cache, no-store, must-revalidate/);
});

test('fallback offline es público, claro y no promete datos privados sin conexión', () => {
  assert.match(offline, /Sin conexión/);
  assert.match(offline, /información privada no se guarda/);
  assert.match(middleware, /pathname === "\/offline"/);
  assert.match(middleware, /sw\.js\|manifest\.webmanifest/);
});

test('registro e instalación son discretos y compatibles con iOS', () => {
  assert.match(pwaClient, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(pwaClient, /beforeinstallprompt/);
  assert.match(pwaClient, /Compartir[\s\S]*Añadir a pantalla de inicio/);
  assert.doesNotMatch(pwaClient, /localStorage|sessionStorage/);
});

test('macro valida, aísla staging y despliega sin convertir stderr normal en error', () => {
  assert.match(macro, /node[\s\S]*--test[\s\S]*tsc[\s\S]*--noEmit[\s\S]*npm[\s\S]*build/);
  assert.match(macro, /feat: add installable PWA/);
  assert.match(macro, /'images\.jpg'/);
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
  assert.match(macro, /\$process\.ExitCode -ne 0/);
  assert.doesNotMatch(macro, /& \$vercelCommand --prod 2>&1/);
  assert.doesNotMatch(macro, /'\.gitignore'/);
});
