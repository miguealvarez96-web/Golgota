export default function ClientsLoading() {
  return <main className="portal-page" aria-busy="true"><h1 className="page-title">Clientes</h1><p role="status" className="mt-3 text-sm text-brand-secondary">Cargando clientes…</p><div aria-hidden="true" className="panel mt-7 h-28 animate-pulse motion-reduce:animate-none" /><div aria-hidden="true" className="mt-5 grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((key) => <div key={key} className="panel h-48 animate-pulse motion-reduce:animate-none" />)}</div></main>;
}
