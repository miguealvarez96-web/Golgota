import Link from "next/link";

const upcomingSections = [
  "Clientes",
  "Membresías",
  "Asistencia",
  "Productos",
  "Gastos",
  "Reportes",
];

export default function PortalNavigation() {
  return (
    <nav aria-label="Navegación del portal">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Portal
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
        <li>
          <Link
            href="/"
            aria-current="page"
            className="flex min-h-12 items-center rounded-lg border border-amber-400 bg-amber-400 px-3 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Dashboard
          </Link>
        </li>
        {upcomingSections.map((section) => (
          <li key={section}>
            <button
              type="button"
              disabled
              className="flex min-h-12 w-full cursor-not-allowed flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-zinc-800 px-3 py-3 text-left text-sm text-zinc-400"
            >
              <span>{section}</span>
              <span className="text-xs text-zinc-500">Próximamente</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
