import Link from "next/link";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";
import PaymentForm from "@/components/membresias/payment-form";
import { displayDate, moneyLabel, type PaymentRow } from "@/lib/membresias/model";

export default async function MembershipDetail({ params, searchParams }: {
  params: { id: string }; searchParams: { pagina?: string; creada?: string };
}) {
  const access = await getClientAccess();
  if (!access || !canManageClients(access.role)) return <Notice text="No tienes permiso para consultar este historial." />;
  const { supabase } = access;
  const membership = await supabase.from("v_membresias_estado")
    .select("id,cliente_id,plan_id,fecha_inicio,fecha_fin,valor,total_abonado,saldo,estado_pago,estado_vigencia")
    .eq("id", params.id).maybeSingle();
  if (membership.error || !membership.data) return <Notice text="No se encontró la membresía o no está disponible." />;
  const item = membership.data;
  const requestedPage = Number(searchParams.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const pageSize = 20;
  const [client, plan, history] = await Promise.all([
    supabase.from("clientes").select("nombre_completo,cedula").eq("id", item.cliente_id).maybeSingle(),
    supabase.from("planes").select("nombre").eq("id", item.plan_id).maybeSingle(),
    supabase.from("pagos").select("id,monto,fecha_pago,metodo_pago", { count: "exact" }).eq("membresia_id", item.id)
      .order("fecha_pago", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
  ]);
  if (client.error || plan.error || history.error || history.count === null) return <Notice text="No fue posible cargar el detalle y los pagos." />;
  const payments = (history.data ?? []) as PaymentRow[];
  const pages = Math.max(1, Math.ceil(history.count / pageSize));
  return <main className="portal-page">
    <Link href="/membresias" className="text-sm text-brand-secondary underline underline-offset-4">← Membresías</Link>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Detalle de membresía</p><h1 className="page-title mt-2">{client.data?.nombre_completo ?? "Cliente"}</h1><p className="mt-2 text-sm text-brand-secondary">{plan.data?.nombre ?? "Plan"} · {client.data?.cedula}</p></div><Link href={`/membresias/nueva?cliente=${item.cliente_id}&desde=${item.id}`} className="btn-secondary">Renovar membresía</Link></div>
    {searchParams.creada === "1" && <p role="status" className="mt-5 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">Membresía creada correctamente.</p>}
    <dl className="panel mt-6 grid gap-5 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="Inicio" value={displayDate(item.fecha_inicio)} /><Metric label="Vencimiento" value={displayDate(item.fecha_fin)} /><Metric label="Vigencia" value={item.estado_vigencia?.replaceAll("_", " ") ?? "Por iniciar"} /><Metric label="Pago" value={item.estado_pago} /><Metric label="Valor" value={moneyLabel(item.valor)} /><Metric label="Abonado" value={moneyLabel(item.total_abonado)} /><Metric label="Saldo" value={moneyLabel(item.saldo)} /></dl>
    {item.estado_pago !== "CANCELADA" && item.saldo > 0 && <div className="mt-6"><PaymentForm membershipId={item.id} balance={item.saldo} /></div>}
    <section className="panel mt-6 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Historial de pagos</h2><span className="text-sm text-brand-secondary">{history.count} {history.count === 1 ? "pago" : "pagos"}</span></div>
      {!payments.length ? <p className="mt-5 text-sm text-brand-secondary">Todavía no hay pagos registrados.</p> : <ol className="mt-5 divide-y divide-brand-border">{payments.map((payment) => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><div><p className="font-medium">{payment.metodo_pago}</p><p className="mt-1 text-brand-secondary">{new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeZone: "America/Guayaquil" }).format(new Date(payment.fecha_pago))}</p></div><strong>{moneyLabel(payment.monto)}</strong></li>)}</ol>}
      {pages > 1 && <nav aria-label="Páginas del historial" className="mt-5 flex items-center justify-between gap-3 text-sm"><span>Página {page} de {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={`/membresias/${item.id}?pagina=${page - 1}`}>Anterior</Link>}{page < pages && <Link className="btn-secondary" href={`/membresias/${item.id}?pagina=${page + 1}`}>Siguiente</Link>}</div></nav>}
    </section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-brand-secondary">{label}</dt><dd className="mt-2 font-semibold">{value}</dd></div>; }
function Notice({ text }: { text: string }) { return <main className="portal-page"><h1 className="page-title">Membresía</h1><div className="panel mt-6 p-6" role="alert">{text}</div></main>; }
