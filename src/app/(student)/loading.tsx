export default function StudentLoading() {
  return <main className="portal-page" aria-busy="true">
    <p role="status" className="eyebrow">Cargando portal…</p>
    <div aria-hidden="true" className="mt-4 grid gap-5 lg:grid-cols-2">
      <div className="panel h-56 animate-pulse motion-reduce:animate-none" />
      <div className="panel h-56 animate-pulse motion-reduce:animate-none" />
    </div>
  </main>;
}
