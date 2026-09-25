export default function AppLoading() {
  return (
    <main className="p-6 text-white sm:p-8" aria-busy="true" aria-label="Cargando Dashboard">
      <div className="mx-auto max-w-6xl">
        <div className="h-9 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" />
          ))}
        </div>
      </div>
    </main>
  );
}
