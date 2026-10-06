"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { reportInventoryIncident } from "@/app/(app)/inventario/actions";
import { incidentTypes, inventoryIncidentSchema, type InventoryRow } from "@/lib/inventario/model";

export default function InventoryIncidentForm({ item, onClose, onSaved }: {
  item: InventoryRow; onClose: () => void; onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const data = new FormData(event.currentTarget);
    const input = { inventario_item_id: item.id, tipo: String(data.get("tipo") ?? ""), observacion: String(data.get("observacion") ?? "") };
    const validation = inventoryIncidentSchema.safeParse(input);
    setError("");
    if (!validation.success) { setError(validation.error.issues[0]?.message ?? "Revisa los datos."); return; }
    busy.current = true; setPending(true);
    try {
      const result = await reportInventoryIncident(input);
      if (result.ok) onSaved(result.message); else setError(result.message);
    } catch { setError("No fue posible reportar la incidencia."); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} aria-labelledby="incident-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
    className="panel m-auto w-[calc(100%_-_2rem)] max-w-xl p-0 text-brand-text backdrop:bg-brand-text/30">
    <form onSubmit={submit} className="p-5 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">{item.categoria}</p><h2 id="incident-form-title" className="page-title mt-2">Reportar incidencia</h2><p className="mt-2 text-sm text-brand-secondary">{item.nombre}</p></div><button type="button" className="btn-secondary" onClick={onClose} disabled={pending} aria-label="Cerrar">✕</button></div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <fieldset disabled={pending} className="mt-6 grid gap-5"><div><label className="field-label" htmlFor="incident-type">Tipo *</label><select autoFocus id="incident-type" name="tipo" className="field">{incidentTypes.map((value) => <option key={value}>{value}</option>)}</select></div><div><label className="field-label" htmlFor="incident-note">Observación *</label><textarea id="incident-note" name="observacion" required maxLength={2000} className="field min-h-32 resize-y" /></div></fieldset>
      <div className="mt-7 flex justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Reportando…" : "Reportar incidencia"}</button></div>
    </form>
  </dialog>;
}
