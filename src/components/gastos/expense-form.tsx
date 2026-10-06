"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveExpense } from "@/app/(app)/gastos/actions";
import { businessDate } from "@/lib/clientes/model";
import { expenseCategories, expensePaymentMethods, expenseSchema, type ExpenseInput, type ExpenseRow } from "@/lib/gastos/model";

export default function ExpenseForm({ expense, onClose, onSaved }: {
  expense: ExpenseRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseInput, string[]>>>({});
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    const input = {
      fecha: String(data.get("fecha") ?? ""), categoria: String(data.get("categoria") ?? ""),
      descripcion: String(data.get("descripcion") ?? ""), monto: String(data.get("monto") ?? ""),
      metodo_pago: String(data.get("metodo_pago") ?? ""), proveedor: String(data.get("proveedor") ?? ""),
      observacion: String(data.get("observacion") ?? ""),
    };
    const validation = expenseSchema.safeParse(input);
    setError(""); setErrors({});
    if (!validation.success) {
      setError("Revisa los campos señalados.");
      setErrors(validation.error.flatten().fieldErrors);
      return;
    }
    busy.current = true; setPending(true);
    try {
      const result = await saveExpense(expense?.id ?? null, input);
      if (result.ok) onSaved(result.message);
      else { setError(result.message); setErrors(result.errors ?? {}); }
    } catch {
      setError("No fue posible guardar el gasto.");
    } finally {
      busy.current = false; setPending(false);
    }
  }

  const fieldError = (name: keyof ExpenseInput) => errors[name]?.[0]
    ? <p className="mt-1 text-sm text-red-700">{errors[name]?.[0]}</p> : null;

  return <dialog ref={dialog} aria-labelledby="expense-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
    className="panel m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-0 text-brand-text backdrop:bg-brand-text/30">
    <form onSubmit={submit} noValidate className="p-5 sm:p-8">
      <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Control operativo</p><h2 id="expense-form-title" className="page-title mt-2">{expense ? "Editar gasto" : "Nuevo gasto"}</h2></div><button type="button" className="btn-secondary" onClick={onClose} disabled={pending} aria-label="Cerrar">✕</button></div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <fieldset disabled={pending} className="mt-6 grid gap-5 sm:grid-cols-2">
        <div><label className="field-label" htmlFor="expense-date">Fecha *</label><input autoFocus id="expense-date" name="fecha" type="date" required className="field" defaultValue={expense?.fecha_gasto ?? businessDate()} />{fieldError("fecha")}</div>
        <div><label className="field-label" htmlFor="expense-category">Categoría *</label><select id="expense-category" name="categoria" required className="field" defaultValue={expense?.tipo_gasto ?? ""}><option value="" disabled>Selecciona</option>{expenseCategories.map((item) => <option key={item}>{item}</option>)}</select>{fieldError("categoria")}</div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="expense-description">Descripción *</label><input id="expense-description" name="descripcion" required maxLength={500} className="field" defaultValue={expense?.descripcion ?? ""} />{fieldError("descripcion")}</div>
        <div><label className="field-label" htmlFor="expense-amount">Monto (USD) *</label><input id="expense-amount" name="monto" type="number" min="0.01" max="99999999.99" step="0.01" required className="field" defaultValue={expense ? Number(expense.monto).toFixed(2) : ""} />{fieldError("monto")}</div>
        <div><label className="field-label" htmlFor="expense-method">Método de pago</label><select id="expense-method" name="metodo_pago" className="field" defaultValue={expense?.metodo_pago ?? ""}><option value="">No indicado</option>{expensePaymentMethods.map((item) => <option key={item}>{item}</option>)}</select>{fieldError("metodo_pago")}</div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="expense-provider">Proveedor</label><input id="expense-provider" name="proveedor" maxLength={160} className="field" defaultValue={expense?.proveedor ?? ""} />{fieldError("proveedor")}</div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="expense-note">Observación</label><textarea id="expense-note" name="observacion" maxLength={2000} className="field min-h-28 resize-y" defaultValue={expense?.observacion ?? ""} />{fieldError("observacion")}</div>
      </fieldset>
      <div className="mt-7 flex justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar gasto"}</button></div>
    </form>
  </dialog>;
}
