"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { title: "Dashboard", href: "/" },
  { title: "Clientes", href: "/clientes" },
  { title: "Membresías", href: "/membresias" },
  { title: "Asistencia", href: "/asistencia" },
  { title: "Productos", href: "/productos" },
  { title: "Gastos", href: "/gastos" },
  { title: "Reportes", href: "/reportes" },
];

export default function PortalNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación del portal">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Portal
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
        {sections.map(({ title, href }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center rounded-lg border px-3 py-3 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  active
                    ? "border-amber-400 bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
