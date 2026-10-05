import Link from "next/link";

import VigencyBadge from "@/components/membresias/vigency-badge";
import { displayDate } from "@/lib/clientes/model";
import type { CoachDashboardData, CoachMembershipAlert } from "@/lib/coaches/data";

export default function CoachDashboard({ data }: { data: CoachDashboardData }) {
  return <main className="portal-page">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Coach · Operación diaria</p><h1 className="page-title mt-2">Panel operativo</h1><p className="mt-2 text-sm text-brand-secondary">Alumnos, vigencias y comunicación del día.</p></div><Link href="/clientes" className="btn-primary">Crear cliente</Link></div>

    <form action="/clientes" className="panel mt-7 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5" role="search">
      <div className="min-w-0 flex-1"><label htmlFor="coach-student-search" className="field-label">Búsqueda rápida de alumno</label><input id="coach-student-search" name="q" type="search" className="field" maxLength={100} placeholder="Nombre, cédula o celular" /></div>
      <button type="submit" className="btn-primary">Buscar alumno</button>
    </form>

    <div className="mt-7 grid gap-5 xl:grid-cols-2">
      <AlertList title="Próximos a vencer" items={data.expiring} empty="No hay membresías próximas a vencer." />
      <AlertList title="Membresías vencidas" items={data.expired} empty="No hay membresías vencidas recientes." />
    </div>

    <div className="mt-7 grid gap-5 lg:grid-cols-2">
      <section className="panel p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Hoy</p><h2 className="mt-2 text-lg font-semibold">WOD del día</h2></div><Link href="/wod" className="text-sm font-medium text-brand-copper underline underline-offset-4">Ver WOD</Link></div>
        {data.wod ? <><h3 className="mt-5 font-semibold">{data.wod.titulo}</h3><p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm leading-7 text-brand-secondary">{data.wod.contenido}</p></> : <p className="mt-5 text-sm text-brand-secondary">Todavía no hay un WOD publicado para hoy.</p>}
      </section>
      <section className="panel p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Equipo</p><h2 className="mt-2 text-lg font-semibold">Comunicados recientes</h2></div><Link href="/comunicados" className="text-sm font-medium text-brand-copper underline underline-offset-4">Ver todos</Link></div>
        {data.announcements.length ? <ol className="mt-4 divide-y divide-brand-border">{data.announcements.map((item) => <li key={item.id} className="py-3"><h3 className="font-medium">{item.titulo}</h3><p className="mt-1 line-clamp-2 text-sm text-brand-secondary">{item.contenido}</p></li>)}</ol> : <p className="mt-5 text-sm text-brand-secondary">No hay comunicados publicados.</p>}
      </section>
    </div>
  </main>;
}

function AlertList({ title, items, empty }: { title: string; items: CoachMembershipAlert[]; empty: string }) {
  return <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-brand-border p-5 sm:px-6"><h2 className="text-lg font-semibold">{title}</h2><span className="rounded-full bg-brand-copper/10 px-3 py-1 text-sm font-semibold text-brand-copper">{items.length}</span></div>
    {!items.length ? <p className="p-6 text-sm text-brand-secondary">{empty}</p> : <ol className="divide-y divide-brand-border">{items.map((item) => <li key={item.membresia_id} className="p-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/membresias/cliente/${item.cliente_id}`} className="font-semibold hover:text-brand-copper">{item.cliente}</Link><p className="mt-1 text-xs text-brand-secondary">{item.cedula}{item.celular ? ` · ${item.celular}` : ""}</p></div><VigencyBadge state={item.estado_vigencia} /></div><p className="mt-3 text-sm text-brand-secondary">{item.plan} · {displayDate(item.fecha_inicio)} — {displayDate(item.fecha_fin)}</p></li>)}</ol>}
  </section>;
}

