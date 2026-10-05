"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import VigencyBadge from "@/components/membresias/vigency-badge";
import type { CollectionItem, ManagementReport } from "@/lib/reportes/data";
import type { ReportPeriodKey } from "@/lib/reportes/model";

const money = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-EC");
const chartColors = ["#0A1D4A", "#A7674E", "#6B738A", "#B07050", "#CBD2DF"];

function displayDate(value: string) {
  return new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function dueLabel(item: CollectionItem) {
  if (item.daysUntilDue < 0) return `${Math.abs(item.daysUntilDue)} ${Math.abs(item.daysUntilDue) === 1 ? "día vencido" : "días vencidos"}`;
  if (item.daysUntilDue === 0) return "Vence hoy";
  return `${item.daysUntilDue} ${item.daysUntilDue === 1 ? "día restante" : "días restantes"}`;
}

function safeCsvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function ReportsDashboard({ report, periodError }: {
  report: ManagementReport;
  periodError: string | null;
}) {
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>(report.period.key);
  const [collectionQuery, setCollectionQuery] = useState("");
  const normalizedQuery = collectionQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const filteredCollections = useMemo(() => report.collections.filter((item) => {
    const name = item.clientName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    return !normalizedQuery || name.includes(normalizedQuery) || item.clientDocument.includes(collectionQuery.trim());
  }), [collectionQuery, normalizedQuery, report.collections]);

  const cards = [
    ["Clientes activos", integer.format(report.metrics.activeClients), "Estado actual"],
    ["Membresías vigentes", integer.format(report.metrics.activeMemberships), "Incluye por vencer y vence hoy"],
    ["Por vencer", integer.format(report.metrics.expiringMemberships), "Próximos 1 a 3 días"],
    ["Vencidas", integer.format(report.metrics.expiredMemberships), "Requieren atención"],
    ["Ingresos confirmados", money.format(report.metrics.confirmedIncome), report.period.label],
    ["Saldo por cobrar", money.format(report.metrics.pendingBalance), "Cartera actual; no es ingreso"],
    ["Gastos", money.format(report.metrics.expenses), report.period.label],
    ["Resultado neto", money.format(report.metrics.net), "Ingresos confirmados − gastos"],
  ];

  function downloadCollections() {
    const header = ["Cliente", "Identificación", "Plan", "Saldo", "Vencimiento", "Estado", "Días hasta vencimiento"];
    const rows = report.collections.map((item) => [
      item.clientName, item.clientDocument, item.plan, item.balance.toFixed(2), item.dueDate,
      item.state.replaceAll("_", " "), item.daysUntilDue,
    ]);
    const csv = [header, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cobranza-${report.period.start}-${report.period.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="portal-page">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">Gestión Gólgota</p><h1 className="page-title mt-2">Reportes</h1>
        <p className="mt-2 text-sm text-brand-secondary">Cifras financieras del período y excepciones operativas al {displayDate(report.today)}.</p></div>
      <button type="button" className="btn-secondary" onClick={downloadCollections} disabled={!report.collections.length}>Exportar cobranza CSV</button>
    </div>

    <form action="/reportes" className="panel mt-7 grid items-end gap-4 p-4 sm:p-5 lg:grid-cols-[13rem_1fr_1fr_auto]">
      <div><label className="field-label" htmlFor="report-period">Período financiero</label>
        <select id="report-period" name="periodo" className="field" value={periodKey} onChange={(event) => setPeriodKey(event.target.value as ReportPeriodKey)}>
          <option value="hoy">Hoy</option><option value="mes_actual">Este mes</option>
          <option value="mes_anterior">Mes anterior</option><option value="personalizado">Rango personalizado</option>
        </select></div>
      <div><label className="field-label" htmlFor="report-from">Desde</label>
        <input id="report-from" name="desde" type="date" className="field" required={periodKey === "personalizado"}
          disabled={periodKey !== "personalizado"} defaultValue={report.period.start} /></div>
      <div><label className="field-label" htmlFor="report-to">Hasta</label>
        <input id="report-to" name="hasta" type="date" className="field" required={periodKey === "personalizado"}
          disabled={periodKey !== "personalizado"} defaultValue={report.period.end} /></div>
      <button type="submit" className="btn-primary">Aplicar período</button>
    </form>
    {periodError && <p role="alert" className="mt-4 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">{periodError} Se mostró el mes actual.</p>}
    <p className="mt-4 text-sm text-brand-secondary">Período aplicado: <strong className="text-brand-text">{displayDate(report.period.start)} – {displayDate(report.period.end)}</strong>. Los saldos y estados son actuales.</p>

    <section aria-label="Indicadores principales" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, note]) => <article key={label} className="panel relative overflow-hidden p-5 before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:bg-brand-copper">
        <h2 className="text-sm font-medium text-brand-secondary">{label}</h2>
        <p className={`mt-4 break-words text-2xl font-semibold tabular-nums ${label === "Resultado neto" && report.metrics.net < 0 ? "text-red-700" : "text-brand-text"}`}>{value}</p>
        <p className="mt-2 text-xs leading-5 text-brand-secondary">{note}</p>
      </article>)}
    </section>

    <section className="mt-7 grid gap-5 xl:grid-cols-2" aria-label="Gráficos de gestión">
      <article className="panel min-w-0 p-5 sm:p-6"><h2 className="text-lg font-semibold">Ingresos confirmados vs. gastos</h2>
        <p className="mt-1 text-sm text-brand-secondary">Movimientos registrados en el período, por fecha de negocio Ecuador.</p>
        <div className="mt-5 h-72" aria-label="Gráfico de ingresos y gastos">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={report.cashflow} margin={{ left: 0, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E7EF" /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} fontSize={11} />
            <YAxis tickFormatter={(value) => `$${Number(value).toLocaleString("es-EC")}`} fontSize={11} width={58} />
            <Tooltip formatter={(value) => money.format(Number(value))} labelFormatter={(value) => displayDate(String(value))} />
            <Legend /><Bar dataKey="income" name="Ingresos" fill="#0A1D4A" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name="Gastos" fill="#A7674E" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </div>
      </article>
      <article className="panel min-w-0 p-5 sm:p-6"><h2 className="text-lg font-semibold">Distribución de membresías</h2>
        <p className="mt-1 text-sm text-brand-secondary">Una sola clasificación basada en la vigencia existente.</p>
        <div className="mt-5 h-72" aria-label="Gráfico de distribución de membresías">
          <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.membershipDistribution} dataKey="count" nameKey="label" innerRadius={55} outerRadius={92} paddingAngle={2}>
            {report.membershipDistribution.map((item, index) => <Cell key={item.state} fill={chartColors[index]} />)}
          </Pie><Tooltip formatter={(value) => integer.format(Number(value))} /><Legend /></PieChart></ResponsiveContainer>
        </div>
      </article>
    </section>

    <section className="panel mt-7 overflow-hidden" aria-labelledby="collections-title">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brand-border p-5 sm:p-6">
        <div><h2 id="collections-title" className="text-lg font-semibold">Cobranza pendiente</h2><p className="mt-1 text-sm text-brand-secondary">Vencidos primero; esta vista no permite modificar pagos.</p></div>
        <div className="w-full sm:w-72"><label htmlFor="collection-search" className="sr-only">Buscar en cobranza</label>
          <input id="collection-search" type="search" className="field" value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} placeholder="Cliente o identificación" /></div>
      </div>
      <ResponsiveTable empty="No hay saldos pendientes para mostrar." hasRows={filteredCollections.length > 0}>
        {filteredCollections.slice(0, 50).map((item) => <tr key={item.membershipId} className="border-t border-brand-border">
          <td className="px-4 py-3"><a className="font-medium text-brand-text underline decoration-brand-border underline-offset-4" href={`/membresias/cliente/${item.clientId}`}>{item.clientName}</a><span className="mt-1 block text-xs text-brand-secondary">{item.clientDocument}</span></td>
          <td className="px-4 py-3">{item.plan}</td><td className="px-4 py-3 font-semibold tabular-nums">{money.format(item.balance)}</td>
          <td className="px-4 py-3">{displayDate(item.dueDate)}<span className="mt-1 block text-xs text-brand-secondary">{dueLabel(item)}</span></td>
          <td className="px-4 py-3"><VigencyBadge state={item.state} /></td>
        </tr>)}
      </ResponsiveTable>
      {filteredCollections.length > 50 && <p className="border-t border-brand-border p-4 text-sm text-brand-secondary">Se muestran las primeras 50 prioridades. El CSV incluye toda la cobranza.</p>}
    </section>

    <section className="mt-7 grid gap-5 xl:grid-cols-2">
      <DetailPanel title="Próximas renovaciones" subtitle="Membresías que vencen hoy o en los próximos tres días">
        {!report.renewals.length ? <Empty text="No hay renovaciones próximas." /> : <div className="divide-y divide-brand-border">{report.renewals.slice(0, 12).map((item) => <div key={item.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.clientName}</p><p className="mt-1 text-xs text-brand-secondary">{item.plan} · {displayDate(item.dueDate)}</p></div><VigencyBadge state={item.state} /></div>)}</div>}
      </DetailPanel>
      <DetailPanel title="Stock bajo" subtitle={`Productos activos con ${lowStockText(report.stock.low, report.stock.out)}`}>
        <div className="mb-4 grid grid-cols-3 gap-3 text-center"><SmallMetric label="Unidades" value={report.stock.units} /><SmallMetric label="Stock bajo" value={report.stock.low} /><SmallMetric label="Sin stock" value={report.stock.out} /></div>
        {!report.stock.items.length ? <Empty text="No hay productos con stock bajo." /> : <div className="divide-y divide-brand-border">{report.stock.items.slice(0, 15).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="font-medium">{item.name}</span><span className={item.stock === 0 ? "font-semibold text-red-700" : "font-semibold text-brand-copper"}>{item.stock} unidades</span></div>)}</div>}
      </DetailPanel>
      <DetailPanel title="Gastos del período" subtitle={`${report.expenseDetails.length.toLocaleString("es-EC")} registros · ${money.format(report.metrics.expenses)}`}>
        {!report.expenseDetails.length ? <Empty text="No hay gastos registrados en el período." /> : <div className="divide-y divide-brand-border">{report.expenseDetails.slice(0, 15).map((item) => <div key={item.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><p className="font-medium">{item.category}</p><p className="mt-1 text-xs text-brand-secondary">{item.description} · {displayDate(item.date)}</p></div><span className="font-semibold tabular-nums">{money.format(item.amount)}</span></div>)}</div>}
      </DetailPanel>
      <DetailPanel title="Productos vendidos" subtitle="Solo ventas registradas como PAGADO; no se suman a caja sin un historial de cobros">
        {!report.sales.available ? <Empty text="La fuente de ventas no está disponible con el esquema actual." /> : !report.sales.ranking.length ? <Empty text="No hay ventas pagadas suficientes en el período para crear un ranking." /> : <div className="divide-y divide-brand-border">{report.sales.ranking.slice(0, 10).map((item, index) => <div key={item.productId} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 py-3 text-sm"><span className="text-brand-secondary">{index + 1}</span><div><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-brand-secondary">{item.units} unidades</p></div><span className="font-semibold tabular-nums">{money.format(item.amount)}</span></div>)}</div>}
      </DetailPanel>
    </section>
  </main>;
}

function ResponsiveTable({ children, empty, hasRows }: { children: ReactNode; empty: string; hasRows: boolean }) {
  if (!hasRows) return <Empty text={empty} />;
  return <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-secondary"><tr>
    <th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Membresía</th><th className="px-4 py-3">Pendiente</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Estado</th>
  </tr></thead><tbody>{children}</tbody></table></div>;
}

function DetailPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <article className="panel p-5 sm:p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-brand-secondary">{subtitle}</p><div className="mt-4">{children}</div></article>;
}
function Empty({ text }: { text: string }) { return <p className="p-5 text-center text-sm text-brand-secondary">{text}</p>; }
function SmallMetric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-brand-bg p-3"><p className="text-xl font-semibold">{integer.format(value)}</p><p className="mt-1 text-xs text-brand-secondary">{label}</p></div>; }
function lowStockText(low: number, out: number) { return `${low} con 1–5 unidades y ${out} sin stock`; }
