import Link from "next/link";
import VigencyBadge from "@/components/membresias/vigency-badge";
import { getClientAccess } from "@/lib/clientes/access";
import { displayDate, moneyLabel } from "@/lib/membresias/model";
import { loadFinancialMemberships, loadMembershipPayments, loadOperationalMemberships, loadPlanNames } from "@/lib/membresias/data";
import { chooseOverview, vigencyOf, type FinancialMembership, type OperationalMembership } from "@/lib/membresias/grouping";

export default async function ClientMembershipHistory({ params }: { params: { id: string } }) {
  const access = await getClientAccess();
  if (!access) return <Notice text="Tu sesión no permite consultar este historial." />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return <Notice text="No se encontró el cliente." />;
  try {
    const { data: client, error } = await access.supabase.from("clientes")
      .select("id,nombre_completo,cedula").eq("id", params.id).maybeSingle();
    if (error || !client) return <Notice text="No se encontró el cliente." />;
    if (access.role === "staff") {
      const rows = await loadOperationalMemberships(access.supabase, client.id);
      return <HistoryShell client={client} staff rows={rows} plans={new Map()} payments={new Map()} />;
    }
    const rows = await loadFinancialMemberships(access.supabase, client.id);
    const planIds = Array.from(new Set(rows.map((row) => row.plan_id)));
    const [plans, payments] = await Promise.all([
      loadPlanNames(access.supabase, planIds),
      loadMembershipPayments(access.supabase, rows.map((row) => row.id)),
    ]);
    return <HistoryShell client={client} staff={false} rows={rows} plans={plans} payments={payments} />;
  } catch {
    return <Notice text="No fue posible cargar el historial. Comprueba tu conexión e inténtalo de nuevo." />;
  }
}

type Payment = { id: string; monto: number; fecha_pago: string; metodo_pago: string };
function HistoryShell({ client, staff, rows, plans, payments }: {
  client: { id: string; nombre_completo: string; cedula: string }; staff: boolean;
  rows: FinancialMembership[] | OperationalMembership[];
  plans: Map<string, string>; payments: Map<string, Payment[]>;
}) {
  const active = rows.filter((row) => !("estado_pago" in row) || row.estado_pago !== "CANCELADA")
    .filter((row) => ["VIGENTE", "POR_VENCER", "VENCE_HOY"].includes(vigencyOf(row)));
  const current = chooseOverview(active);
  const future = rows.filter((row) => (!("estado_pago" in row) || row.estado_pago !== "CANCELADA") && vigencyOf(row) === "POR_INICIAR")
    .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin));
  const previous = rows.filter((row) => ("estado_pago" in row && row.estado_pago === "CANCELADA") || vigencyOf(row) === "VENCIDA")
    .sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin));
  const otherActive = active.filter((row) => row !== current);
  const render = (row: FinancialMembership | OperationalMembership, index: number) =>
    <MembershipCard key={"id" in row ? row.id : `${row.fecha_fin}-${index}`} row={row} clientId={client.id}
      plan={"plan_id" in row ? plans.get(row.plan_id) ?? "Plan no disponible" : row.plan}
      payments={"id" in row ? payments.get(row.id) ?? [] : []} staff={staff} />;
  return <main className="portal-page">
    <Link href="/membresias" className="text-sm text-brand-secondary underline underline-offset-4">← Membresías</Link>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Historial por cliente</p>
      <h1 className="page-title mt-2">{client.nombre_completo}</h1><p className="mt-2 text-sm text-brand-secondary">Identificación · {client.cedula}</p></div>
      {!staff && <Link className="btn-primary" href={`/membresias/nueva?cliente=${client.id}`}>Nueva membresía</Link>}
    </div>
    <section className="mt-7"><h2 className="text-lg font-semibold">Membresía actual</h2>
      {current ? <div className="mt-4">{render(current, 0)}</div> : <p className="panel mt-4 p-5 text-sm text-brand-secondary">No tiene una membresía vigente hoy.</p>}
    </section>
    {otherActive.length > 0 && <section className="mt-8"><h2 className="text-lg font-semibold">Otras vigentes</h2><div className="mt-4 grid gap-4">{otherActive.map(render)}</div></section>}
    <section className="mt-8"><h2 className="text-lg font-semibold">Renovaciones futuras</h2>
      {future.length ? <div className="mt-4 grid gap-4">{future.map(render)}</div>
        : <p className="panel mt-4 p-5 text-sm text-brand-secondary">No hay membresías futuras.</p>}
    </section>
    <section className="mt-8"><h2 className="text-lg font-semibold">Membresías anteriores</h2>
      {previous.length ? <div className="mt-4 grid gap-4">{previous.map(render)}</div>
        : <p className="panel mt-4 p-5 text-sm text-brand-secondary">No hay membresías anteriores.</p>}
    </section>
  </main>;
}

function MembershipCard({ row, plan, clientId, payments, staff }: {
  row: FinancialMembership | OperationalMembership; plan: string; clientId: string;
  payments: Payment[]; staff: boolean;
}) {
  const state = vigencyOf(row);
  const cancelled = "estado_pago" in row && row.estado_pago === "CANCELADA";
  return <article className="panel p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{plan}</h3>
      <p className="mt-1 text-sm text-brand-secondary">Hasta {displayDate(row.fecha_fin)}</p></div>
      <div className="flex flex-wrap gap-2"><VigencyBadge state={state} />{cancelled && <span className="rounded-full border border-brand-border bg-brand-bg px-3 py-1 text-xs font-semibold">CANCELADA</span>}</div>
    </div>
    <dl className={`mt-5 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 ${staff ? "lg:grid-cols-2" : "lg:grid-cols-4"}`}>
      {!staff && <Metric label="Inicio" value={"fecha_inicio" in row ? displayDate(row.fecha_inicio) : "—"} />}
      <Metric label="Vencimiento" value={displayDate(row.fecha_fin)} />
      {!staff && <Metric label="Estado de pago" value={"estado_pago" in row ? row.estado_pago : "—"} />}
      {!staff && <Metric label="Saldo pendiente" value={"saldo" in row ? moneyLabel(Number(row.saldo)) : "—"} />}
    </dl>
    {!staff && "id" in row && <>
      <div className="mt-5 flex flex-wrap gap-2"><Link className="btn-secondary" href={`/membresias/${row.id}`}>Ver detalle y registrar pago</Link>
        <Link className="btn-secondary" href={`/membresias/nueva?cliente=${clientId}&desde=${row.id}`}>Renovar</Link></div>
      <div className="mt-5 border-t border-brand-border pt-4"><h4 className="text-sm font-semibold">Historial de pagos · {payments.length}</h4>
        {payments.length ? <ol className="mt-3 divide-y divide-brand-border">{payments.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <span>{payment.metodo_pago} · {new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeZone: "America/Guayaquil" }).format(new Date(payment.fecha_pago))}</span>
          <strong>{moneyLabel(Number(payment.monto))}</strong></li>)}</ol>
          : <p className="mt-2 text-sm text-brand-secondary">Sin pagos registrados.</p>}
      </div>
    </>}
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}
function Notice({ text }: { text: string }) {
  return <main className="portal-page"><h1 className="page-title">Historial de membresías</h1>
    <div className="panel mt-6 p-6" role="alert">{text}</div></main>;
}
