export default function ModulePlaceholder({ title }: { title: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-white">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-zinc-400">Módulo en construcción</p>
    </main>
  );
}
