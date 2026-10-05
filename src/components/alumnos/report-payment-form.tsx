"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { reportStudentPayment } from "@/app/(student)/portal/actions";
import {
  reportPaymentSchema,
  validatePaymentReceiptMetadata,
  type ReportPaymentInput,
} from "@/lib/alumnos/model";
import { businessDate } from "@/lib/clientes/model";

export default function ReportPaymentForm({ membershipId }: { membershipId: string | null }) {
  const [message, setMessage] = useState("");
  const [serverError, setServerError] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ReportPaymentInput>({
    resolver: zodResolver(reportPaymentSchema),
    defaultValues: {
      monto: undefined,
      fecha_pago: businessDate(),
      observacion: "",
      membresia_id: membershipId,
    },
  });

  async function submit(values: ReportPaymentInput) {
    setMessage("");
    setServerError("");
    setReceiptError("");
    if (!receipt) {
      setReceiptError("Adjunta el comprobante del pago.");
      return;
    }
    const validation = validatePaymentReceiptMetadata(receipt);
    if (!validation.ok) {
      setReceiptError(validation.message);
      return;
    }
    const formData = new FormData();
    formData.set("monto", String(values.monto));
    formData.set("fecha_pago", values.fecha_pago);
    formData.set("observacion", values.observacion);
    if (values.membresia_id) formData.set("membresia_id", values.membresia_id);
    formData.set("comprobante", receipt);
    const result = await reportStudentPayment(formData);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    setMessage(result.message);
    reset({
      monto: undefined,
      fecha_pago: businessDate(),
      observacion: "",
      membresia_id: membershipId,
    });
    setReceipt(null);
    setFileInputKey((value) => value + 1);
  }

  const errorFor = (name: keyof ReportPaymentInput) => errors[name]?.message
    ? <p className="mt-1.5 text-sm text-red-700">{errors[name]?.message}</p>
    : null;

  return <section id="reportar-pago" className="panel p-5 sm:p-7">
    <p className="eyebrow">Verificación manual</p>
    <h2 className="mt-2 text-xl font-semibold">Reportar pago</h2>
    <p className="mt-2 text-sm leading-relaxed text-brand-secondary">
      Adjunta una foto o PDF del comprobante. El pago quedará pendiente hasta ser verificado por Gólgota.
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
        <div className="sm:col-span-2"><label htmlFor="student-payment-receipt" className="field-label">Comprobante adjunto *</label>
          <input key={fileInputKey} id="student-payment-receipt" className="field file:mr-4 file:rounded-lg file:border-0 file:bg-brand-bg file:px-3 file:py-2 file:font-medium file:text-brand-text"
            type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setReceipt(selected);
              if (!selected) {
                setReceiptError("");
                return;
              }
              const validation = validatePaymentReceiptMetadata(selected);
              setReceiptError(validation.ok ? "" : validation.message);
            }} aria-invalid={Boolean(receiptError)} />
          {receipt && <p className="mt-2 text-sm text-brand-secondary">{receipt.name} · {(receipt.size / 1024 / 1024).toFixed(2)} MB</p>}
          {receiptError && <p className="mt-1.5 text-sm text-red-700">{receiptError}</p>}
          <p className="mt-1.5 text-xs text-brand-secondary">JPG, JPEG, PNG o PDF. Máximo 5 MB.</p>
        </div>
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
