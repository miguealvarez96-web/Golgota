import Link from "next/link";
import { getClientAccess } from "@/lib/clientes/access";
import { displayDate, membershipSearchFilter, moneyLabel, paymentStates, vigencyStates, type MembershipRow, type StaffMembershipRow } from "@/lib/membresias/model";

type Filters = { q?: string; vigencia?: string; pago?: string; pagina?: string; cliente?: string };
const pageSize = 20;

export default async function MembresiasPage({ searchParams }: { searchParams: Filters }) {
  const access = await getClientAccess();
  if (!access) return <Notice text="Tu sesión no permite consultar membresías." />;
  const staff = access.role === "staff";
  const q = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const vigencia = vigencyStates.find((item) => item === searchParams.vigencia) ?? "";
  const pago = !staff ? paymentStates.find((item) => item === searchParams.pago) ?? "" : "";
  const cliente = typeof searchParams.cliente === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.cliente) ? searchParams.cliente : "";
  const requestedPage = Number(searchParams.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const supabase = access.supabase;

  let clientIds: string[] | null = null;
  if (q) {
    const match = await supabase.from("clientes").select("id", { count: "exact" }).or(membershipSearchFilter(q)).limit(1000);
    if (match.error) return <Notice text="No fue posible buscar clientes." />;
    if (match.count !== null && match.count > 1000) return <Notice text="La búsqueda devuelve demasiados clientes. Usa un nombre más específico." />;
    clientIds = (match.data ?? []).map((item) => item.id);
  }
  if (q && !clientIds?.length) return <MembershipShell staff={staff} q={q} vigencia={vigencia} pago={pago} cliente={cliente} total={0} page={page} rows={[]} />;

  if (staff) {
    let request = supabase.from("v_membresias_verificacion").select("cliente_id,plan,fecha_fin,estado_vigencia", { count: "exact" });
    if (cliente) request = request.eq("cliente_id", cliente);
    if (clientIds) request = request.in("cliente_id", clientIds);
    if (vigencia) request = request.eq("estado_vigencia", vigencia);
    const result = await request.order("fecha_fin", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error || result.count === null) return <Notice text="No fue posible cargar la verificación de vigencia. La migración local podría estar pendiente." />;
    const names = await clientNames(supabase, (result.data ?? []).map((row) => row.cliente_id));
    if (!names) return <Notice text="No fue posible cargar los clientes." />;
    const rows = (result.data ?? []).map((row) => ({ ...row, cliente: names.get(row.cliente_id) ?? "Cliente no disponible" })) as StaffMembershipRow[];
    return <MembershipShell staff q={q} vigencia={vigencia} pago="" cliente={cliente} total={result.count} page={page} rows={rows} />;
  }
  let request = supabase.from("v_membresias_estado").select("id,cliente_id,plan_id,fecha_inicio,fecha_fin,valor,total_abonado,saldo,estado_pago,estado_vigencia,created_at", { count: "exact" });
  if (cliente) request = request.eq("cliente_id", cliente);
  if (clientIds) request = request.in("cliente_id", clientIds);
  if (vigencia) request = request.eq("estado_vigencia", vigencia);
  if (pago) request = request.eq("estado_pago", pago);
  const result = await request.order("fecha_fin", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (result.error || result.count === null) return <Notice text="No fue posible cargar las membresías." />;
  const names = await clientNames(supabase, (result.data ?? []).map((row) => row.cliente_id));
  if (!names) return <Notice text="No fue posible cargar los clientes." />;
  const planIds = Array.from(new Set((result.data ?? []).map((row) => row.plan_id)));
  const planResult = planIds.length ? await supabase.from("planes").select("id,nombre").in("id", planIds) : { data: [], error: null };
  if (planResult.error) return <Notice text="No fue posible cargar los planes." />;
  const plans = new Map((planResult.data ?? []).map((item) => [item.id, item.nombre]));
  const rows = (result.data ?? []).map((row) => ({ ...row, cliente: names.get(row.cliente_id) ?? "Cliente no disponible", plan: plans.get(row.plan_id) ?? "Plan no disponible" })) as MembershipRow[];
  return <MembershipShell staff={false} q={q} vigencia={vigencia} pago={pago} cliente={cliente} total={result.count} page={page} rows={rows} />;
}

async function clientNames(supabase: NonNullable<Awaited<ReturnType<typeof getClientAccess>>>["supabase"], ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const result = await supabase.from("clientes").select("id,nombre_completo").in("id", Array.from(new Set(ids)));
  return result.error ? null : new Map((result.data ?? []).map((row) => [row.id, row.nombre_completo]));
}

function MembershipShell({ staff, q, vigencia, pago, cliente, total, page, rows }: {
  staff: boolean; q: string; vigencia: string; pago: string; cliente: string; total: number; page: number;
  rows: MembershipRow[] | StaffMembershipRow[];
}) {
  const pageUrl = (number: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q); if (vigencia) params.set("vigencia", vigencia);
    if (pago) params.set("pago", pago); if (cliente) params.set("cliente", cliente);
    if (number > 1) params.set("pagina", String(number));
    return `/membresias?${params}`;
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <main className="portal-page">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="eyebrow">Operación Gólgota</p><h1 className="page-title mt-2">Membresías</h1><p className="mt-2 text-sm text-brand-secondary">Consulta la vigencia y el historial de cada alumno.</p></div>
      {!staff && <Link className="btn-primary" href={cliente ? `/membresias/nueva?cliente=${cliente}` : "/membresias/nueva"}>Nueva membresía</Link>}
    </div>
    <form action="/membresias" className={`panel mt-7 grid items-end gap-4 p-4 sm:p-5 ${staff ? "sm:grid-cols-[minmax(0,1fr)_12rem_auto]" : "sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]"}`} role="search">
      {cliente && <input type="hidden" name="cliente" value={cliente} />}
      <div><label htmlFor="member-search" className="field-label">Buscar cliente</label><input id="member-search" name="q" type="search" className="field" defaultValue={q} placeholder="Nombre o cédula" /></div>
      <div><label htmlFor="member-vigency" className="field-label">Vigencia</label><select id="member-vigency" name="vigencia" className="field" defaultValue={vigencia}><option value="">Todas</option>{vigencyStates.map((value) => <option key={value} value={value}>{vigencyLabel(value)}</option>)}</select></div>
      {!staff && <div><label htmlFor="member-payment" className="field-label">Estado de pago</label><select id="member-payment" name="pago" className="field" defaultValue={pago}><option value="">Todos</option>{paymentStates.map((value) => <option key={value}>{value}</option>)}</select></div>}
      <button type="submit" className="btn-secondary">Filtrar</button>
    </form>
    <div className="my-5 flex flex-wrap justify-between gap-3 text-sm text-brand-secondary"><p>{total.toLocaleString("es-EC")} {total === 1 ? "resultado" : "resultados"}</p><Link href="/membresias" className="underline underline-offset-4">Limpiar filtros</Link></div>
    {!rows.length ? <div className="panel p-10 text-center text-brand-secondary">No hay membresías para estos filtros.</div> : <div className="grid gap-3">{rows.map((row, index) => <article key={"id" in row ? row.id : `${row.cliente_id}-${row.fecha_fin}-${index}`} className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-brand-text">{row.cliente}</h2><p className="mt-1 text-sm text-brand-secondary">{row.plan} · Hasta {displayDate(row.fecha_fin)}</p></div><span className="rounded-full border border-brand-copper/40 bg-brand-copper/10 px-3 py-1 text-xs font-semibold text-brand-text">{vigencyLabel(row.estado_vigencia)}</span></div>
      {"id" in row && <><dl className="mt-5 grid gap-3 border-t border-brand-border pt-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Inicio" value={displayDate(row.fecha_inicio)} /><Metric label="Fin" value={displayDate(row.fecha_fin)} />
        <Metric label="Valor" value={moneyLabel(row.valor)} /><Metric label="Abonado" value={moneyLabel(row.total_abonado)} />
        <Metric label="Saldo" value={moneyLabel(row.saldo)} /><Metric label="Pago" value={row.estado_pago} />
      </dl><Link className="btn-secondary mt-5" href={`/membresias/${row.id}`}>Ver detalle e historial</Link></>}
    </article>)}</div>}
    {pages > 1 && <nav aria-label="Páginas de membresías" className="mt-6 flex items-center justify-between gap-3 text-sm"><span>Página {page} de {pages}</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={pageUrl(page - 1)}>Anterior</Link>}{page < pages && <Link className="btn-secondary" href={pageUrl(page + 1)}>Siguiente</Link>}</div></nav>}
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function vigencyLabel(value: string | null) { return !value ? "Por iniciar" : value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }
function Notice({ text }: { text: string }) { return <main className="portal-page"><h1 className="page-title">Membresías</h1><div className="panel mt-6 p-6" role="alert">{text}</div></main>; }
