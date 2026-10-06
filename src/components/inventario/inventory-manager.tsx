"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveInventoryIncident } from "@/app/(app)/inventario/actions";
import {
  inventoryMoneyLabel, inventoryStates, type InventoryIncidentRow,
  type InventoryManagementRow, type InventoryRow,
} from "@/lib/inventario/model";
import InventoryIncidentForm from "./inventory-incident-form";
import InventoryItemForm from "./inventory-item-form";

export default function InventoryManager({ items, incidents, canManage, query, state }: {
  items: InventoryRow[]; incidents: InventoryIncidentRow[]; canManage: boolean; query: string; state: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [itemForm, setItemForm] = useState<InventoryManagementRow | null | undefined>(undefined);
  const [incidentItem, setIncidentItem] = useState<InventoryRow | null>(null);
  const [resolutionStates, setResolutionStates] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function resolve(incident: InventoryIncidentRow) {
    if (!window.confirm("¿Marcar esta incidencia como resuelta?")) return;
    setMessage(""); setError("");
    startTransition(async () => {
      const itemState = resolutionStates[incident.id] || undefined;
      const result = await resolveInventoryIncident(incident.id, itemState);
      if (result.ok) { setMessage(result.message); router.refresh(); } else setError(result.message);
    });
  }

  return <main className="portal-page"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Activos del box</p><h1 className="page-title mt-2">Inventario</h1><p className="mt-2 text-sm text-brand-secondary">Qué tenemos, cuántos tenemos y en qué estado está.</p></div>{canManage && <button type="button" className="btn-primary" onClick={() => setItemForm(null)}>Nuevo item</button>}</div>
    <form action="/inventario" className="panel mt-7 grid items-end gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_13rem_auto]" role="search"><div><label className="field-label" htmlFor="inventory-search">Buscar</label><input id="inventory-search" name="q" type="search" className="field" defaultValue={query} placeholder="Nombre o categoría" /></div><div><label className="field-label" htmlFor="inventory-state-filter">Estado</label><select id="inventory-state-filter" name="estado" className="field" defaultValue={state}><option value="">Todos</option>{inventoryStates.map((value) => <option key={value} value={value}>{stateLabel(value)}</option>)}</select></div><button type="submit" className="btn-secondary">Filtrar</button></form>
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}{error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p className="my-5 text-sm text-brand-secondary">{items.length.toLocaleString("es-EC")} items encontrados.</p>
    {!items.length ? <div className="panel p-10 text-center text-brand-secondary">No hay items que coincidan con los filtros.</div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="panel flex flex-col p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-brand-secondary">{item.categoria}</p><h2 className="mt-1 break-words text-lg font-semibold">{item.nombre}</h2></div><InventoryBadge state={item.estado} /></div><dl className="mt-5 grid grid-cols-2 gap-4 border-t border-brand-border pt-4 text-sm"><Metric label="Cantidad" value={item.cantidad.toLocaleString("es-EC")} /><Metric label="Ubicación" value={item.ubicacion ?? "No indicada"} />{"costo" in item && <><Metric label="Costo" value={inventoryMoneyLabel(item.costo)} /><Metric label="Fecha de compra" value={item.fecha_compra ?? "No indicada"} /></>}</dl>{item.observacion && <p className="mt-4 rounded-xl bg-brand-bg p-3 text-sm text-brand-secondary">{item.observacion}</p>}<div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-brand-border pt-4">{canManage && "costo" in item && <button type="button" className="btn-secondary" onClick={() => setItemForm(item)}>Editar</button>}<button type="button" className="btn-secondary" onClick={() => setIncidentItem(item)}>Reportar incidencia</button></div></article>)}</div>}
    <section className="mt-8"><div><p className="eyebrow">Seguimiento</p><h2 className="mt-2 text-xl font-semibold">Incidencias</h2></div>{!incidents.length ? <p className="panel mt-4 p-5 text-sm text-brand-secondary">No hay incidencias visibles.</p> : <div className="mt-4 grid gap-3">{incidents.map((incident) => { const item = items.find((entry) => entry.id === incident.inventario_item_id); return <details key={incident.id} className="panel group overflow-hidden"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-5 marker:hidden"><span className="flex items-center gap-2 font-medium"><span aria-hidden="true" className="text-brand-copper transition group-open:rotate-90">▶</span>{item?.nombre ?? "Item de inventario"}</span><span className="text-sm text-brand-secondary">{incident.tipo}</span><IncidentBadge state={incident.estado} /></summary><div className="border-t border-brand-border p-5"><p className="text-sm">{incident.observacion}</p><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3"><Metric label="Reportado por" value={incident.reportado_por} /><Metric label="Fecha" value={new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(incident.fecha))} />{incident.estado === "RESUELTO" && <Metric label="Resuelto por" value={incident.resuelto_por ?? "No disponible"} />}</dl>{canManage && incident.estado === "PENDIENTE" && <div className="mt-4 flex flex-wrap items-end justify-end gap-3"><div className="w-full sm:w-64"><label className="field-label" htmlFor={`resolution-state-${incident.id}`}>Estado real al resolver</label><select id={`resolution-state-${incident.id}`} className="field" disabled={pending} value={resolutionStates[incident.id] ?? ""} onChange={(event) => setResolutionStates((current) => ({ ...current, [incident.id]: event.target.value }))}><option value="">No cambiar estado</option>{inventoryStates.map((value) => <option key={value} value={value}>{stateLabel(value)}</option>)}</select></div><button type="button" className="btn-primary" disabled={pending} onClick={() => resolve(incident)}>{pending ? "Procesando…" : "Marcar resuelta"}</button></div>}</div></details>; })}</div>}</section>
    {itemForm !== undefined && <InventoryItemForm item={itemForm} onClose={() => setItemForm(undefined)} onSaved={(notice) => { setItemForm(undefined); setMessage(notice); startTransition(() => router.refresh()); }} />}
    {incidentItem && <InventoryIncidentForm item={incidentItem} onClose={() => setIncidentItem(null)} onSaved={(notice) => { setIncidentItem(null); setMessage(notice); startTransition(() => router.refresh()); }} />}
  </main>;
}

function stateLabel(value: string) { return value === "DANADO" ? "Dañado" : value.charAt(0) + value.slice(1).toLowerCase(); }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>; }
function InventoryBadge({ state }: { state: InventoryRow["estado"] }) { const color = state === "BUENO" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : state === "MANTENIMIENTO" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-700"; return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>{stateLabel(state)}</span>; }
function IncidentBadge({ state }: { state: InventoryIncidentRow["estado"] }) { return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${state === "RESUELTO" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{state}</span>; }
