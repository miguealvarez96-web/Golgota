"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import PortalIcon, { type PortalIconName } from "./portal-icon";

const sections: { title: string; href: string; icon: PortalIconName }[] = [
  { title: "Dashboard", href: "/", icon: "dashboard" },
  { title: "Clientes", href: "/clientes", icon: "clients" },
  { title: "Membresías", href: "/membresias", icon: "membership" },
  { title: "Asistencia", href: "/asistencia", icon: "attendance" },
  { title: "Productos", href: "/productos", icon: "products" },
  { title: "Gastos", href: "/gastos", icon: "expenses" },
  { title: "Reportes", href: "/reportes", icon: "reports" },
];

export default function PortalNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación del portal">
      <p className="eyebrow mb-4 hidden px-3 lg:block">
        Portal
      </p>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
        {sections.map(({ title, href, icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border-brand-copper/25 bg-brand-copper/10 font-semibold text-brand-text shadow-[inset_3px_0_0_#A7674E] hover:bg-brand-copper/15"
                    : "border-transparent text-brand-secondary hover:border-brand-border hover:bg-brand-bg hover:text-brand-text"
                }`}
              >
                <PortalIcon name={icon} />{title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
