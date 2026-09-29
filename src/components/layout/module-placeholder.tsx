export default function ModulePlaceholder({ title }: { title: string }) {
  return (
    <main className="portal-page">
      <h1 className="page-title">{title}</h1>
      <div className="panel mt-6 p-6"><p className="text-brand-secondary">Módulo en construcción</p></div>
    </main>
  );
}
