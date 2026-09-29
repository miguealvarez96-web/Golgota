"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createMembership } from "@/app/(app)/membresias/actions";
import { businessDate, moneyLabel, overlapsMembership, paymentMethods } from "@/lib/membresias/model";

type Plan = { id: string; nombre: string; precio: number; duracion_dias: number };
export default function MembershipForm({ client, plans, initialPlanId, renewal, previous, suggestedStartDate }: {
  client: { id: string; nombre_completo: string }; plans: Plan[]; initialPlanId?: string; renewal: boolean;
  previous: { fecha_inicio: string; fecha_fin: string; estado_pago: string } | null; suggestedStartDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [planId, setPlanId] = useState(plans.some((item) => item.id === initialPlanId) ? initialPlanId! : plans[0]?.id ?? "");
  const [deposit, setDeposit] = useState("0");
  const plan = plans.find((item) => item.id === planId);
  const max = Number(plan?.precio ?? 0);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    if (plan && overlapsMembership(previous, String(form.get("fecha_inicio") ?? ""), plan.duracion_dias)) {
      setMessage("El cliente ya tiene una membresía que se superpone con estas fechas.");
      return;
    }
    startTransition(async () => {
      const result = await createMembership({
        cliente_id: client.id, plan_id: String(form.get("plan_id") ?? ""),
        fecha_inicio: String(form.get("fecha_inicio") ?? ""),
        abono_inicial: String(form.get("abono_inicial") ?? "0"),
        metodo_pago: String(form.get("metodo_pago") ?? ""),
        fecha_pago: String(form.get("fecha_pago") ?? ""),
      });
      if (result.ok) router.replace(`/membresias/${result.id}?creada=1`);
      else setMessage(result.message);
    });
  }
  return <form onSubmit={submit} className="panel mt-6 max-w-2xl space-y-5 p-5 sm:p-7">
    <div><p className="field-label">Cliente</p><p className="font-semibold">{client.nombre_completo}</p></div>
    <div><label htmlFor="plan-id" className="field-label">Plan</label><select id="plan-id" name="plan_id" className="field" value={planId} onChange={(event) => setPlanId(event.target.value)} required>{plans.map((item) => <option key={item.id} value={item.id}>{item.nombre} · {moneyLabel(item.precio)} · {item.duracion_dias} {item.duracion_dias === 1 ? "día" : "días"}</option>)}</select><p className="mt-2 text-xs text-brand-secondary">El precio y la duración se toman del plan activo en la base.</p></div>
    <div><label htmlFor="member-start" className="field-label">{renewal ? "Inicio de la nueva membresía" : "Fecha de inicio"}</label><input id="member-start" name="fecha_inicio" type="date" className="field" defaultValue={suggestedStartDate} min={renewal ? businessDate() : undefined} required /><p className="mt-2 text-xs text-brand-secondary">{renewal ? "Se sugiere el primer día sin solapamiento con la membresía anterior; puedes elegir una fecha posterior." : "Puedes dejar la fecha de hoy o indicar otra."}</p></div>
    <div><label htmlFor="member-deposit" className="field-label">Abono inicial opcional (USD)</label><input id="member-deposit" name="abono_inicial" type="number" min="0" max={max} step="0.01" className="field" value={deposit} onChange={(event) => setDeposit(event.target.value)} required /><p className="mt-2 text-xs text-brand-secondary">Si es mayor que cero, se registrará como un pago individual.</p></div>
    {Number(deposit) > 0 && <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="member-method" className="field-label">Método del abono</label><select id="member-method" name="metodo_pago" className="field" required defaultValue=""><option value="">Seleccionar</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></div><div><label htmlFor="member-payment-date" className="field-label">Fecha del abono</label><input id="member-payment-date" name="fecha_pago" type="date" className="field" defaultValue={businessDate()} required /></div></div>}
    {Number(deposit) === 0 && <input name="fecha_pago" type="hidden" value={businessDate()} />}
    {message && <p role="alert" className="rounded-xl border border-brand-copper/50 bg-brand-copper/10 p-3 text-sm">{message}</p>}
    <button type="submit" className="btn-primary" disabled={pending || !plan}>{pending ? "Guardando…" : renewal ? "Crear renovación" : "Crear membresía"}</button>
  </form>;
}
