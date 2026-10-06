"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveInventoryItem } from "@/app/(app)/inventario/actions";
import { inventoryItemSchema, inventoryStates, type InventoryItemInput, type InventoryManagementRow } from "@/lib/inventario/model";

export default function InventoryItemForm({ item, onClose, onSaved }: {
  item: InventoryManagementRow | null; onClose: () => void; onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof InventoryItemInput, string[]>>>({});
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    const input = {
      nombre: String(data.get("nombre") ?? ""), categoria: String(data.get("categoria") ?? ""),
      cantidad: String(data.get("cantidad") ?? ""), estado: String(data.get("estado") ?? ""),
      fecha_compra: String(data.get("fecha_compra") ?? ""), costo: String(data.get("costo") ?? ""),
      ubicacion: String(data.get("ubicacion") ?? ""), observacion: String(data.get("observacion") ?? ""),
    };
    const validation = inventoryItemSchema.safeParse(input);
    setError(""); setErrors({});
    if (!validation.success) { setError("Revisa los campos señalados."); setErrors(validation.error.flatten().fieldErrors); return; }
    busy.current = true; setPending(true);
    try {
      const result = await saveInventoryItem(item?.id ?? null, input);
      if (result.ok) onSaved(result.message);
      else { setError(result.message); setErrors(result.errors ?? {}); }
    } catch { setError("No fue posible guardar el item."); }
    finally { busy.current = false; setPending(false); }
  }
  const fieldError = (name: keyof InventoryItemInput) => errors[name]?.[0]
    ? <p className="mt-1 text-sm text-red-700">{errors[name]?.[0]}</p> : null;

  return <dialog ref={dialog} aria-labelledby="inventory-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
    className="panel m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-0 text-brand-text backdrop:bg-brand-text/30">
    <form onSubmit={submit} noValidate className="p-5 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Activos del box</p><h2 id="inventory-form-title" className="page-title mt-2">{item ? "Editar item" : "Nuevo item"}</h2></div><button type="button" className="btn-secondary" onClick={onClose} disabled={pending} aria-label="Cerrar">✕</button></div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <fieldset disabled={pending} className="mt-6 grid gap-5 sm:grid-cols-2">
        <div><label className="field-label" htmlFor="inventory-name">Nombre *</label><input autoFocus id="inventory-name" name="nombre" required maxLength={255} className="field" defaultValue={item?.nombre ?? ""} />{fieldError("nombre")}</div>
        <div><label className="field-label" htmlFor="inventory-category">Categoría *</label><input id="inventory-category" name="categoria" required maxLength={100} className="field" defaultValue={item?.categoria ?? ""} />{fieldError("categoria")}</div>
        <div><label className="field-label" htmlFor="inventory-quantity">Cantidad *</label><input id="inventory-quantity" name="cantidad" type="number" min="0" max="2147483647" step="1" required className="field" defaultValue={item?.cantidad ?? 0} />{fieldError("cantidad")}</div>
        <div><label className="field-label" htmlFor="inventory-state">Estado *</label><select id="inventory-state" name="estado" className="field" defaultValue={item?.estado ?? "BUENO"}>{inventoryStates.map((value) => <option key={value}>{value}</option>)}</select>{fieldError("estado")}</div>
        <div><label className="field-label" htmlFor="inventory-date">Fecha de compra</label><input id="inventory-date" name="fecha_compra" type="date" className="field" defaultValue={item?.fecha_compra ?? ""} />{fieldError("fecha_compra")}</div>
        <div><label className="field-label" htmlFor="inventory-cost">Costo (USD)</label><input id="inventory-cost" name="costo" type="number" min="0" max="99999999.99" step="0.01" className="field" defaultValue={item?.costo === null || item?.costo === undefined ? "" : Number(item.costo).toFixed(2)} />{fieldError("costo")}</div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="inventory-location">Ubicación</label><input id="inventory-location" name="ubicacion" maxLength={160} className="field" defaultValue={item?.ubicacion ?? ""} />{fieldError("ubicacion")}</div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="inventory-note">Observación operativa</label><textarea id="inventory-note" name="observacion" maxLength={2000} className="field min-h-28 resize-y" defaultValue={item?.observacion ?? ""} />{fieldError("observacion")}</div>
      </fieldset>
      <div className="mt-7 flex justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar item"}</button></div>
    </form>
  </dialog>;
}
