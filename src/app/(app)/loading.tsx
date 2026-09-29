export default function AppLoading() {
  return (
    <main className="portal-page" aria-busy="true" aria-label="Cargando panel">
      <div>
        <p role="status" className="eyebrow">Cargando panel…</p>
        <div className="mt-3 h-9 w-48 animate-pulse rounded bg-brand-surface motion-reduce:animate-none" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="panel h-36 animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </main>
  );
}
