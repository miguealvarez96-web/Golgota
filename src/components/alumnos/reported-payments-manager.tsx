"use client";

import { useState, useTransition } from "react";
import { reviewReportedPayment } from "@/app/(app)/pagos-reportados/actions";
import { moneyLabel, type AdminPaymentReport } from "@/lib/alumnos/model";
import { displayDate } from "@/lib/clientes/model";

export default function ReportedPaymentsManager({ reports }: { reports: AdminPaymentReport[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function review(id: string, decision: "aprobar" | "rechazar") {
    let motivo = "";
    if (decision === "aprobar") {
      if (!window.confirm("¿Aprobar y aplicar este pago a la membresía? Esta acción registra un pago real.")) return;
    } else {
      const answer = window.prompt("Motivo del rechazo (opcional, máximo 500 caracteres):", "");
      if (answer === null) return;
      motivo = answer;
    }
    setMessage(""); setError("");
    startTransition(async () => {
      const result = await reviewReportedPayment({ reporte_id: id, decision, motivo });
      if (result.ok) setMessage(result.message);
      else setError(result.message);
    });
  }

  return <>
    {message && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!reports.length ? <div className="panel p-10 text-center text-brand-secondary">No hay pagos reportados.</div>
      : <div className="grid gap-4">{reports.map((report) => <article key={report.id} className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{report.alumno}</h2>
            <p className="mt-1 text-sm text-brand-secondary">Reportado {new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeZone: "America/Guayaquil" }).format(new Date(report.created_at))}</p></div>
          <StatusBadge state={report.estado} />
        </div>
        <dl className="mt-5 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Monto" value={moneyLabel(report.monto)} />
          <Metric label="Fecha de pago" value={displayDate(report.fecha_pago)} />
          <Metric label="Banco / origen" value={report.banco_origen} />
          <Metric label="Referencia" value={report.referencia} />
        </dl>
        {report.observacion && <p className="mt-4 rounded-xl bg-brand-bg p-3 text-sm"><span className="font-medium">Observación:</span> {report.observacion}</p>}
        {report.estado === "RECHAZADO" && report.motivo_rechazo && <p className="mt-4 text-sm text-red-700"><span className="font-medium">Motivo:</span> {report.motivo_rechazo}</p>}
        {report.estado === "APROBADO" && report.pago_real_id && <p className="mt-4 text-sm text-emerald-800">Pago real aplicado y vinculado.</p>}
        {!report.membresia_id && <p className="mt-4 text-sm text-amber-900">Sin membresía asociada: no puede aprobarse hasta resolver la asociación.</p>}
        {report.estado === "PENDIENTE" && <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-brand-border pt-4">
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => review(report.id, "rechazar")}>Rechazar</button>
          <button type="button" className="btn-primary" disabled={pending || !report.membresia_id} onClick={() => review(report.id, "aprobar")}>Aprobar</button>
        </div>}
      </article>)}</div>}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function StatusBadge({ state }: { state: AdminPaymentReport["estado"] }) {
  const colors = state === "APROBADO" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : state === "RECHAZADO" ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${colors}`}>{state}</span>;
}
