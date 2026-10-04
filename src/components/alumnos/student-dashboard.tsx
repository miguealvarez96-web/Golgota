import VigencyBadge from "@/components/membresias/vigency-badge";
import { chooseStudentMembership, moneyLabel, type StudentPortal } from "@/lib/alumnos/model";
import { displayDate } from "@/lib/clientes/model";
import ReportPaymentForm from "./report-payment-form";

export default function StudentDashboard({ data }: { data: StudentPortal }) {
  const current = chooseStudentMembership(data.membresias);
  const payableMembership = current && current.estado_pago !== "CANCELADA" && current.saldo > 0 ? current.id : null;
  const firstName = data.cliente.nombre_completo.split(/\s+/)[0];

  return <main className="portal-page">
    <div>
      <p className="eyebrow">Portal del alumno</p>
      <h1 className="page-title mt-2">Hola, {firstName}</h1>
      <p className="mt-2 text-sm text-brand-secondary">Consulta tu membresía y reporta transferencias para verificación.</p>
    </div>

    <section className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <article className="panel relative overflow-hidden p-5 sm:p-7">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-copper" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-medium text-brand-secondary">Membresía actual</p>
            <h2 className="mt-2 text-2xl font-semibold">{current?.plan ?? "Sin membresía"}</h2></div>
          {current && <VigencyBadge state={current.estado_vigencia} />}
        </div>
        {current ? <>
          <dl className="mt-7 grid gap-5 border-t border-brand-border pt-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Inicio" value={displayDate(current.fecha_inicio)} />
            <Metric label="Vencimiento" value={displayDate(current.fecha_fin)} />
            <Metric label="Días restantes" value={current.dias_restantes >= 0 ? String(current.dias_restantes) : "0"} />
            <Metric label="Saldo" value={moneyLabel(current.saldo)} />
          </dl>
          <a href="#reportar-pago" className="btn-primary mt-6">Reportar pago</a>
        </> : <p className="mt-6 text-sm text-brand-secondary">No encontramos una membresía asociada a tu cuenta.</p>}
      </article>

      <article className="panel p-5 sm:p-7">
        <p className="eyebrow">Mi perfil</p>
        <dl className="mt-5 space-y-4 text-sm">
          <Metric label="Nombre" value={data.cliente.nombre_completo} />
          <Metric label="Identificación" value={data.cliente.cedula} />
          <Metric label="Correo" value={data.cliente.email ?? "No registrado"} />
          <Metric label="Celular" value={data.cliente.celular ?? "No registrado"} />
        </dl>
      </article>
    </section>

    <div className="mt-7 grid gap-7 xl:grid-cols-2">
      <ReportPaymentForm membershipId={payableMembership} />
      <ReportsHistory reports={data.reportes} />
    </div>

    <section className="mt-8">
      <h2 className="text-lg font-semibold">Historial de membresías</h2>
      <div className="mt-4 grid gap-4">
        {data.membresias.length ? data.membresias.map((membership) => <article key={membership.id} className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-semibold">{membership.plan}</h3>
              <p className="mt-1 text-sm text-brand-secondary">{displayDate(membership.fecha_inicio)} — {displayDate(membership.fecha_fin)}</p></div>
            <VigencyBadge state={membership.estado_vigencia} />
          </div>
          <dl className="mt-4 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2">
            <Metric label="Estado de pago" value={membership.estado_pago} />
            <Metric label="Saldo" value={moneyLabel(membership.saldo)} />
          </dl>
        </article>) : <p className="panel p-5 text-sm text-brand-secondary">Aún no tienes historial de membresías.</p>}
      </div>
    </section>
  </main>;
}

function ReportsHistory({ reports }: { reports: StudentPortal["reportes"] }) {
  return <section className="panel p-5 sm:p-7">
    <p className="eyebrow">Seguimiento</p><h2 className="mt-2 text-xl font-semibold">Pagos reportados</h2>
    {reports.length ? <ol className="mt-5 divide-y divide-brand-border">{reports.map((report) => <li key={report.id} className="py-4 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{moneyLabel(report.monto)}</p>
          <p className="mt-1 text-sm text-brand-secondary">{report.banco_origen} · {report.referencia}</p></div>
        <ReportBadge state={report.estado} />
      </div>
      <p className="mt-2 text-xs text-brand-secondary">Pago del {displayDate(report.fecha_pago)}</p>
      <p className="mt-1 text-xs text-brand-secondary">Reportado {reportDateTime(report.created_at)}</p>
      {report.estado === "PENDIENTE" && <p className="mt-2 text-sm text-amber-900">Pendiente de verificación. Todavía no modifica tu saldo.</p>}
      {report.estado === "APROBADO" && <p className="mt-2 text-sm font-medium text-emerald-800">Pago aprobado y aplicado a tu membresía.</p>}
      {report.estado === "RECHAZADO" && report.motivo_rechazo && <p className="mt-2 text-sm text-red-700">Motivo: {report.motivo_rechazo}</p>}
      {report.reviewed_at && <p className="mt-1 text-xs text-brand-secondary">Revisado {reportDateTime(report.reviewed_at)}</p>}
    </li>)}</ol> : <p className="mt-5 text-sm text-brand-secondary">Todavía no has reportado pagos.</p>}
  </section>;
}

function ReportBadge({ state }: { state: "PENDIENTE" | "APROBADO" | "RECHAZADO" }) {
  const colors = state === "APROBADO" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : state === "RECHAZADO" ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${colors}`}>{state}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium text-brand-text">{value}</dd></div>;
}

function reportDateTime(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  }).format(new Date(value));
}
