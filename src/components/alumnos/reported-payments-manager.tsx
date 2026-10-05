"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewReportedPayment } from "@/app/(app)/pagos-reportados/actions";
import {
  filterAdminPaymentReports,
  moneyLabel,
  type AdminPaymentReport,
  type ReportFilter,
} from "@/lib/alumnos/model";
import { displayDate } from "@/lib/clientes/model";
import PaymentReceiptButton from "./payment-receipt-button";

const filters: { value: ReportFilter; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "APROBADO", label: "Aprobados" },
  { value: "RECHAZADO", label: "Rechazados" },
];

export default function ReportedPaymentsManager({ reports }: { reports: AdminPaymentReport[] }) {
  const router = useRouter();
  const activeReview = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<ReportFilter>("PENDIENTE");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const visibleReports = useMemo(
    () => filterAdminPaymentReports(reports, stateFilter, query),
    [reports, stateFilter, query],
  );

  async function review(id: string, decision: "aprobar" | "rechazar") {
    if (activeReview.current) return;
    let motivo = "";
    if (decision === "aprobar") {
      if (!window.confirm("¿Aprobar y aplicar este pago a la membresía? Se registrará un pago real y esta acción no puede repetirse.")) return;
    } else {
      const answer = window.prompt("Motivo del rechazo (obligatorio, entre 3 y 500 caracteres):", "");
      if (answer === null) return;
      motivo = answer.trim();
      if (motivo.length < 3) {
        setMessage("");
        setError("Indica un motivo de rechazo de al menos 3 caracteres.");
        return;
      }
    }

    activeReview.current = id;
    setActiveId(id);
    setMessage("");
    setError("");
    try {
      const result = await reviewReportedPayment({ reporte_id: id, decision, motivo });
      if (result.ok) {
        setMessage(result.message);
        router.refresh();
      } else {
        setError(result.message);
      }
    } finally {
      activeReview.current = null;
      setActiveId(null);
    }
  }

  return <>
    <section className="panel p-4 sm:p-5" aria-label="Filtros de pagos reportados">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <label htmlFor="reported-payments-search" className="field-label">Buscar alumno</label>
          <input
            id="reported-payments-search"
            className="field"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre del alumno"
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar por estado">
          {filters.map((filter) => {
            const count = filter.value === "TODOS"
              ? reports.length
              : reports.filter((report) => report.estado === filter.value).length;
            return <button
              key={filter.value}
              type="button"
              onClick={() => setStateFilter(filter.value)}
              aria-pressed={stateFilter === filter.value}
              className={stateFilter === filter.value ? "btn-primary" : "btn-secondary"}
            >
              {filter.label} ({count})
            </button>;
          })}
        </div>
      </div>
    </section>

    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {!visibleReports.length
      ? <div className="panel mt-5 p-10 text-center text-brand-secondary">No hay pagos reportados que coincidan con el filtro.</div>
      : <div className="mt-5 grid gap-4">{visibleReports.map((report) => {
        const canApply = report.membresia_id
          && report.saldo_membresia !== null
          && report.saldo_membresia > 0
          && report.monto <= report.saldo_membresia
          && report.estado_pago_membresia !== "CANCELADA";
        return <article key={report.id} className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{report.alumno}</h2>
              <p className="mt-1 text-sm text-brand-secondary">Reportado {dateTimeLabel(report.created_at)}</p>
            </div>
            <StatusBadge state={report.estado} />
          </div>

          <dl className="mt-5 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Membresía" value={membershipLabel(report)} />
            <Metric label="Monto reportado" value={moneyLabel(report.monto)} />
            <Metric label="Fecha del pago" value={displayDate(report.fecha_pago)} />
            <Metric label="Saldo actual" value={report.saldo_membresia === null ? "No disponible" : moneyLabel(report.saldo_membresia)} />
            <Metric label="Estado de membresía" value={report.estado_pago_membresia ?? "No disponible"} />
            <Metric label="Cuenta reportante" value={report.usuario_id} />
            <Metric label="ID del reporte" value={report.id} />
          </dl>

          {report.observacion && <p className="mt-4 rounded-xl bg-brand-bg p-3 text-sm"><span className="font-medium">Observación:</span> {report.observacion}</p>}
          {(report.banco_origen || report.referencia) && <p className="mt-3 text-xs text-brand-secondary">Datos históricos: {[report.banco_origen, report.referencia].filter(Boolean).join(" · ")}</p>}
          {report.comprobante_path && report.comprobante_mime
            ? <PaymentReceiptButton reportId={report.id} />
            : <p className="mt-3 text-xs text-brand-secondary">Sin comprobante adjunto (reporte histórico).</p>}

          {report.estado !== "PENDIENTE" && <dl className="mt-4 grid gap-4 rounded-xl border border-brand-border bg-brand-bg p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Revisor" value={report.revisor ?? report.reviewed_by ?? "No disponible"} />
            <Metric label="Fecha de revisión" value={report.reviewed_at ? dateTimeLabel(report.reviewed_at) : "No disponible"} />
            {report.estado === "APROBADO" && <>
              <Metric label="Pago real" value={report.pago_real_id ?? "No disponible"} />
              <Metric label="Monto aplicado" value={report.monto_aplicado === null ? "No disponible" : moneyLabel(report.monto_aplicado)} />
            </>}
          </dl>}

          {report.estado === "RECHAZADO" && <p className="mt-4 text-sm text-red-700"><span className="font-medium">Motivo del rechazo:</span> {report.motivo_rechazo ?? "No disponible"}</p>}
          {report.estado === "APROBADO" && report.pago_real_id && <p className="mt-4 text-sm font-medium text-emerald-800">Pago aprobado, aplicado y vinculado a la membresía.</p>}
          {report.estado === "PENDIENTE" && !canApply && <p className="mt-4 text-sm text-amber-900">No puede aprobarse con el saldo o la membresía actuales. Puede rechazarse conservando la trazabilidad.</p>}

          {report.estado === "PENDIENTE" && <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-brand-border pt-4">
            <button type="button" className="btn-secondary" disabled={activeId !== null} onClick={() => review(report.id, "rechazar")}>
              {activeId === report.id ? "Procesando…" : "Rechazar"}
            </button>
            <button type="button" className="btn-primary" disabled={activeId !== null || !canApply} onClick={() => review(report.id, "aprobar")}>
              {activeId === report.id ? "Procesando…" : "Aprobar"}
            </button>
          </div>}
        </article>;
      })}</div>}
  </>;
}

function membershipLabel(report: AdminPaymentReport) {
  if (!report.membresia) return "Sin membresía asociada";
  if (!report.membresia_fecha_inicio || !report.membresia_fecha_fin) return report.membresia;
  return `${report.membresia} · ${displayDate(report.membresia_fecha_inicio)} — ${displayDate(report.membresia_fecha_fin)}`;
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  }).format(new Date(value));
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function StatusBadge({ state }: { state: AdminPaymentReport["estado"] }) {
  const colors = state === "APROBADO" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : state === "RECHAZADO" ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${colors}`}>{state}</span>;
}
