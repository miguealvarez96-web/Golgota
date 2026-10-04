"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { reportStudentPayment } from "@/app/(student)/portal/actions";
import { reportPaymentSchema, type ReportPaymentInput } from "@/lib/alumnos/model";
import { businessDate } from "@/lib/clientes/model";

export default function ReportPaymentForm({ membershipId }: { membershipId: string | null }) {
  const [message, setMessage] = useState("");
  const [serverError, setServerError] = useState("");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ReportPaymentInput>({
    resolver: zodResolver(reportPaymentSchema),
    defaultValues: {
      monto: undefined,
      fecha_pago: businessDate(),
      banco_origen: "",
      referencia: "",
      observacion: "",
      membresia_id: membershipId,
    },
  });

  async function submit(values: ReportPaymentInput) {
    setMessage("");
    setServerError("");
    const result = await reportStudentPayment(values);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    setMessage(result.message);
    reset({
      monto: undefined,
      fecha_pago: businessDate(),
      banco_origen: "",
      referencia: "",
      observacion: "",
      membresia_id: membershipId,
    });
  }

  const errorFor = (name: keyof ReportPaymentInput) => errors[name]?.message
    ? <p className="mt-1.5 text-sm text-red-700">{errors[name]?.message}</p>
    : null;

  return <section id="reportar-pago" className="panel p-5 sm:p-7">
    <p className="eyebrow">Verificación manual</p>
    <h2 className="mt-2 text-xl font-semibold">Reportar pago</h2>
    <p className="mt-2 text-sm leading-relaxed text-brand-secondary">
      El reporte no se considera pagado hasta que el equipo de Gólgota lo apruebe.
    </p>
    {!membershipId && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      No hay una membresía disponible para asociar. Puedes enviar el reporte, pero deberá revisarse antes de poder aplicarlo.
    </p>}
    {serverError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{serverError}</p>}
    {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</p>}
    <form onSubmit={handleSubmit(submit)} noValidate className="mt-6 grid gap-5 sm:grid-cols-2">
      <fieldset disabled={isSubmitting} className="contents">
        <div><label htmlFor="student-payment-amount" className="field-label">Monto (USD) *</label>
          <input id="student-payment-amount" className="field" type="number" min="0.01" max="99999999.99" step="0.01" inputMode="decimal"
            {...register("monto", { valueAsNumber: true })} aria-invalid={Boolean(errors.monto)} />{errorFor("monto")}</div>
        <div><label htmlFor="student-payment-date" className="field-label">Fecha del pago *</label>
          <input id="student-payment-date" className="field" type="date" max={businessDate()}
            {...register("fecha_pago")} aria-invalid={Boolean(errors.fecha_pago)} />{errorFor("fecha_pago")}</div>
        <div><label htmlFor="student-payment-bank" className="field-label">Banco u origen *</label>
          <input id="student-payment-bank" className="field" maxLength={120} placeholder="Ej. Banco Pichincha"
            {...register("banco_origen")} aria-invalid={Boolean(errors.banco_origen)} />{errorFor("banco_origen")}</div>
        <div><label htmlFor="student-payment-reference" className="field-label">Referencia o comprobante *</label>
          <input id="student-payment-reference" className="field" maxLength={120} placeholder="Número de transacción"
            {...register("referencia")} aria-invalid={Boolean(errors.referencia)} />{errorFor("referencia")}</div>
        <div className="sm:col-span-2"><label htmlFor="student-payment-note" className="field-label">Observación</label>
          <textarea id="student-payment-note" className="field min-h-24 resize-y" maxLength={1000}
            {...register("observacion")} aria-invalid={Boolean(errors.observacion)} />{errorFor("observacion")}</div>
      </fieldset>
      <div className="sm:col-span-2 flex justify-end border-t border-brand-border pt-5">
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={isSubmitting}>
          {isSubmitting ? "Enviando…" : "Reportar pago"}
        </button>
      </div>
    </form>
  </section>;
}
