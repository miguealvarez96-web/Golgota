"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { registerPayment } from "@/app/(app)/membresias/actions";
import { businessDate, moneyLabel, paymentMethods } from "@/lib/membresias/model";

export default function PaymentForm({ membershipId, balance }: { membershipId: string; balance: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setMessage("");
    startTransition(async () => {
      const result = await registerPayment({ membresia_id: membershipId, monto: String(values.get("monto") ?? ""), metodo_pago: String(values.get("metodo_pago") ?? ""), fecha_pago: String(values.get("fecha_pago") ?? "") });
      setMessage(result.message);
      if (result.ok) { form.reset(); router.refresh(); }
    });
  }
  return <form onSubmit={submit} className="panel p-5 sm:p-6"><h2 className="text-lg font-semibold">Registrar pago</h2><p className="mt-2 text-sm text-brand-secondary">Saldo restante: {moneyLabel(balance)}</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-3"><div><label htmlFor="payment-amount" className="field-label">Monto (USD)</label><input id="payment-amount" name="monto" type="number" min="0.01" max={balance} step="0.01" className="field" required /></div><div><label htmlFor="payment-method" className="field-label">Método</label><select id="payment-method" name="metodo_pago" className="field" required defaultValue=""><option value="">Seleccionar</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></div><div><label htmlFor="payment-date" className="field-label">Fecha</label><input id="payment-date" name="fecha_pago" type="date" className="field" required defaultValue={businessDate()} /></div></div>
    {message && <p role={message.startsWith("Pago registrado") ? "status" : "alert"} className="mt-4 text-sm">{message}</p>}
    <button type="submit" className="btn-primary mt-5" disabled={pending}>{pending ? "Registrando…" : "Registrar pago"}</button>
  </form>;
}
