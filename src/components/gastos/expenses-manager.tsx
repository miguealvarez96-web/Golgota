"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidExpense } from "@/app/(app)/gastos/actions";
import { displayDate } from "@/lib/clientes/model";
import { expenseCategories, moneyLabel, type ExpenseRow } from "@/lib/gastos/model";
import ExpenseForm from "./expense-form";

export default function ExpensesManager({ expenses, totalActive, query, category, from, to }: {
  expenses: ExpenseRow[]; totalActive: number; query: string; category: string; from: string; to: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ExpenseRow | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);

  function annul(expense: ExpenseRow) {
    if (!window.confirm("¿Anular este gasto? Se conservará en el historial y se excluirá de los totales.")) return;
    setMessage(""); setError("");
    startTransition(async () => {
      const result = await voidExpense(expense.id);
      if (result.ok) { setMessage(result.message); router.refresh(); }
      else setError(result.message);
    });
  }

  return <main className="portal-page">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Administración del box</p><h1 className="page-title mt-2">Gastos</h1><p className="mt-2 text-sm text-brand-secondary">Registro operativo sin eliminación física.</p></div><button ref={newButton} type="button" className="btn-primary" onClick={() => setForm(null)}>Nuevo gasto</button></div>
    <section className="mt-7 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <article className="panel p-5"><h2 className="text-sm font-medium text-brand-secondary">Total gastos activos</h2><p className="mt-4 text-3xl font-semibold tabular-nums">{moneyLabel(totalActive)}</p><p className="mt-2 text-xs text-brand-secondary">Según período y categoría aplicados.</p></article>
      <form action="/gastos" className="panel grid items-end gap-4 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem_auto]" role="search">
        <div><label className="field-label" htmlFor="expense-search">Buscar</label><input id="expense-search" name="q" type="search" className="field" defaultValue={query} placeholder="Descripción o proveedor" /></div>
        <div><label className="field-label" htmlFor="expense-category-filter">Categoría</label><select id="expense-category-filter" name="categoria" className="field" defaultValue={category}><option value="">Todas</option>{expenseCategories.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div><label className="field-label" htmlFor="expense-from">Desde</label><input id="expense-from" name="desde" type="date" className="field" defaultValue={from} /></div>
        <div><label className="field-label" htmlFor="expense-to">Hasta</label><input id="expense-to" name="hasta" type="date" className="field" defaultValue={to} /></div>
        <button type="submit" className="btn-secondary">Filtrar</button>
      </form>
    </section>
    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p className="my-5 text-sm text-brand-secondary">{expenses.length.toLocaleString("es-EC")} gastos encontrados.</p>
    {!expenses.length ? <div className="panel p-10 text-center text-brand-secondary">No hay gastos que coincidan con los filtros.</div> : <div className="grid gap-3">{expenses.map((expense) => <details key={expense.id} className="panel group overflow-hidden">
      <summary className="grid cursor-pointer list-none items-center gap-3 p-5 marker:hidden sm:grid-cols-[7rem_11rem_minmax(0,1fr)_8rem_7rem]">
        <span>{displayDate(expense.fecha_gasto)}</span><span className="text-sm text-brand-secondary">{expense.tipo_gasto}</span><span className="flex min-w-0 items-center gap-2 font-medium"><span aria-hidden="true" className="text-brand-copper transition group-open:rotate-90">▶</span><span className="truncate">{expense.descripcion}</span></span><strong>{moneyLabel(Number(expense.monto))}</strong><ExpenseBadge state={expense.estado} />
      </summary>
      <div className="border-t border-brand-border p-5"><dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="Método de pago" value={expense.metodo_pago ?? "No indicado"} /><Metric label="Proveedor" value={expense.proveedor ?? "No indicado"} /><Metric label="Creado por" value={expense.created_by ?? "Registro histórico"} /><Metric label="Estado" value={expense.estado} /></dl>
        {expense.observacion && <p className="mt-4 rounded-xl bg-brand-bg p-4 text-sm"><span className="font-medium">Observación:</span> {expense.observacion}</p>}
        {expense.estado === "ANULADO" && <p className="mt-4 text-sm text-brand-secondary">Anulado {expense.anulado_at ? new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(expense.anulado_at)) : ""}.</p>}
        {expense.estado === "ACTIVO" && <div className="mt-5 flex justify-end gap-3 border-t border-brand-border pt-4"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setForm(expense)}>Editar</button><button type="button" className="btn-secondary text-red-700" disabled={pending} onClick={() => annul(expense)}>Anular</button></div>}
      </div>
    </details>)}</div>}
    {form !== undefined && <ExpenseForm expense={form} onClose={() => setForm(undefined)} onSaved={(notice) => { setForm(undefined); setMessage(notice); startTransition(() => router.refresh()); }} />}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function ExpenseBadge({ state }: { state: ExpenseRow["estado"] }) {
  return <span className={`justify-self-start rounded-full border px-3 py-1 text-xs font-semibold ${state === "ACTIVO" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-brand-border text-brand-secondary"}`}>{state}</span>;
}
