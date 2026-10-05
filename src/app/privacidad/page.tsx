import type { Metadata } from "next";
import Brand from "@/components/layout/brand";
import { PRIVACY_NOTICE_DATE, PRIVACY_NOTICE_VERSION } from "@/lib/privacidad/model";

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description: "Aviso de privacidad técnico provisional de Gólgota CrossFit.",
};

const pending = "PENDIENTE DE DEFINICIÓN Y VALIDACIÓN LEGAL/ADMINISTRATIVA";

export default function PrivacyPage() {
  return <main className="min-h-screen bg-brand-bg px-4 py-6 text-brand-text sm:px-8 sm:py-10">
    <article className="mx-auto max-w-4xl">
      <header className="panel p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5"><Brand subtitle="Privacidad" />
          <a href="/login" className="btn-secondary">Volver al acceso</a></div>
        <div className="mt-7 border-t border-brand-border pt-6">
          <p className="eyebrow">Documento técnico provisional</p>
          <h1 className="page-title mt-2">Aviso de privacidad</h1>
          <p className="mt-3 leading-7 text-brand-secondary">Este texto describe la infraestructura y los tratamientos observables en la aplicación. Debe ser revisado y aprobado por la persona responsable y por asesoría jurídica antes de considerarse un aviso definitivo.</p>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><Info label="Versión" value={PRIVACY_NOTICE_VERSION} /><Info label="Fecha de publicación técnica" value={PRIVACY_NOTICE_DATE} /></dl>
        </div>
      </header>

      <div className="mt-6 space-y-6">
        <Section title="1. Responsable del tratamiento">
          <p>Nombre comercial del proyecto: <strong>Gólgota CrossFit</strong>.</p>
          <Placeholder label="Razón social" /><Placeholder label="RUC" /><Placeholder label="Dirección" />
          <Placeholder label="Responsable del tratamiento" /><Placeholder label="Correo de privacidad" />
        </Section>

        <Section title="2. Datos tratados por la plataforma">
          <List items={[
            "Cuenta y autenticación: identificador de Auth, correo, nombre, rol y estado de cuenta. La aplicación no guarda contraseñas.",
            "Ficha de cliente: identificación, nombre, teléfono, correo, fechas y datos operativos registrados por personal autorizado.",
            "Membresías y pagos: plan, vigencia, valor, saldo, pagos confirmados y trazabilidad de reportes de pago.",
            "Operación: productos, asistencia cuando se implemente, WOD, comunicados y acciones administrativas.",
            "Seguridad y auditoría: usuario, tabla, acción, identificador, valores anteriores/nuevos y fecha.",
            "Privacidad: versión del aviso reconocida, fecha, contexto, preferencia opcional de comunicaciones y solicitudes del titular.",
          ]} />
          <p className="mt-4 text-sm text-brand-secondary">No deben escribirse contraseñas, tokens, secretos ni datos personales innecesarios en observaciones, WOD, comunicados o solicitudes.</p>
        </Section>

        <Section title="3. Finalidades y bases de tratamiento">
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Finalidad</th><th className="p-3">Uso funcional</th><th className="p-3">Base aplicable</th></tr></thead><tbody className="divide-y divide-brand-border">
            <Purpose purpose="Administrar cuenta y acceso" use="Autenticar, asignar roles y proteger rutas." />
            <Purpose purpose="Gestionar relación deportiva y comercial" use="Clientes, membresías, pagos y servicios contratados." />
            <Purpose purpose="Seguridad y trazabilidad" use="RLS, control de acceso, prevención de fraude y auditoría." />
            <Purpose purpose="Atender derechos del titular" use="Recibir, revisar y responder solicitudes sin borrado automático." />
            <Purpose purpose="Comunicaciones promocionales opcionales" use="Solo si el alumno marca una casilla separada y no premarcada." basis="Consentimiento opcional registrado; alcance y canal pendientes de definición." />
          </tbody></table></div>
          <p className="mt-4 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm"><strong>Importante:</strong> reconocer este aviso no constituye consentimiento indiscriminado para todos los tratamientos. La base exacta de cada finalidad debe definirse y documentarse con revisión jurídica.</p>
        </Section>

        <Section title="4. Conservación">
          <p>La plataforma conserva historial financiero, membresías y auditoría para mantener integridad y trazabilidad. No existe borrado automático desde el portal.</p>
          <Placeholder label="Plazos por categoría de datos y criterio de conservación" />
          <p className="mt-3 text-sm text-brand-secondary">Una solicitud de eliminación será evaluada antes de cualquier medida, considerando obligaciones de conservación y derechos de terceros.</p>
        </Section>

        <Section title="5. Proveedores, destinatarios y transferencias">
          <p>La arquitectura usa Supabase para base de datos y autenticación, y Vercel para alojamiento. Deben documentarse sus roles contractuales, ubicaciones, subencargados y transferencias aplicables.</p>
          <Placeholder label="Inventario definitivo de encargados, terceros y transferencias" />
        </Section>

        <Section title="6. Seguridad">
          <p>La aplicación implementa autenticación, roles, RLS, RPC controladas, auditoría y separación entre portales. La PWA no guarda respuestas autenticadas ni datos financieros para uso offline. Ninguna medida elimina totalmente el riesgo y los controles deben revisarse periódicamente.</p>
        </Section>

        <Section title="7. Derechos y solicitudes">
          <p>El titular puede iniciar solicitudes de acceso, rectificación, actualización, eliminación cuando proceda, oposición, portabilidad, suspensión u otras relacionadas con sus datos. Los alumnos autenticados pueden hacerlo desde “Privacidad y mis datos”. Las solicitudes reciben revisión humana y no eliminan datos automáticamente.</p>
          <p className="mt-3">Canal alternativo: <span className="font-semibold text-brand-copper">[{pending}: correo o canal verificable]</span>.</p>
        </Section>

        <Section title="8. Cambios del aviso y contacto">
          <p>Cada cambio material debe publicar una nueva versión y, cuando corresponda, solicitar un nuevo reconocimiento o consentimiento específico.</p>
          <Placeholder label="Contacto formal para privacidad y procedimiento de verificación de identidad" />
          <p className="mt-4 text-sm text-brand-secondary">Referencias oficiales consultadas: <a className="underline underline-offset-4" href="https://www.registroficial.gob.ec/quinto-suplemento-al-registro-oficial-no-459/" rel="noreferrer" target="_blank">LOPDP en Registro Oficial</a> y <a className="underline underline-offset-4" href="https://spdp.gob.ec/politica-de-proteccion-de-datos/" rel="noreferrer" target="_blank">información de la SPDP</a>.</p>
        </Section>
      </div>
      <p className="py-8 text-center text-xs text-brand-secondary">Este documento no reemplaza asesoría jurídica ni una evaluación administrativa del tratamiento real.</p>
    </article>
  </main>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel p-5 leading-7 sm:p-7"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4 text-sm text-brand-secondary">{children}</div></section>;
}
function Placeholder({ label }: { label: string }) { return <p className="mt-2"><strong>{label}:</strong> <span className="font-semibold text-brand-copper">[{pending}]</span></p>; }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }
function List({ items }: { items: string[] }) { return <ul className="list-disc space-y-2 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul>; }
function Purpose({ purpose, use, basis = `[${pending}]` }: { purpose: string; use: string; basis?: string }) { return <tr><td className="p-3 font-medium text-brand-text">{purpose}</td><td className="p-3">{use}</td><td className="p-3">{basis}</td></tr>; }
