import Link from "next/link";
import VigencyBadge from "@/components/membresias/vigency-badge";
import { getClientAccess } from "@/lib/clientes/access";
import { displayDate, moneyLabel } from "@/lib/membresias/model";
import { loadClientIdentities, loadFinancialMemberships, loadOperationalMemberships, loadPlanNames } from "@/lib/membresias/data";
import { filterClientGroups, groupByClient, vigencyLabel, vigencyOf, type ClientMembershipGroup, type FinancialMembership, type MembershipFilter, type OperationalMembership } from "@/lib/membresias/grouping";

type Filters = { q?: string; filtro?: string; pagina?: string; cliente?: string };
const pageSize = 20;
const staffFilters: MembershipFilter[] = ["", "vigentes", "por_vencer", "vencidas"];
const financialFilters: MembershipFilter[] = [...staffFilters, "saldo_pendiente", "pagadas"];
const filterLabels: Record<MembershipFilter, string> = {
  "": "Todos", vigentes: "Vigentes", por_vencer: "Por vencer",
  vencidas: "Vencidas", saldo_pendiente: "Saldo pendiente", pagadas: "Pagadas",
};

export default async function MembresiasPage({ searchParams }: { searchParams: Filters }) {
  const access = await getClientAccess();
  if (!access) return <Notice text="Tu sesión no permite consultar membresías." />;
  const staff = access.role === "staff";
  const query = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const filter = (staff ? staffFilters : financialFilters).find((value) => value === searchParams.filtro) ?? "";
  const clientId = typeof searchParams.cliente === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.cliente) ? searchParams.cliente : "";
  const requestedPage = Number(searchParams.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;

  try {
    const rows = staff
      ? await loadOperationalMemberships(access.supabase, clientId || undefined)
      : await loadFinancialMemberships(access.supabase, clientId || undefined);
    const ids = Array.from(new Set(rows.map((row) => row.cliente_id)));
    const clients = await loadClientIdentities(access.supabase, ids);
    const groups = groupByClient(rows as (OperationalMembership | FinancialMembership)[], clients);
    const filtered = filterClientGroups(groups, query, filter);
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
    const planIds = staff ? [] : Array.from(new Set(visible.flatMap((group) => group.memberships)
      .filter((row): row is FinancialMembership => "plan_id" in row).map((row) => row.plan_id)));
    const plans = staff ? new Map<string, string>() : await loadPlanNames(access.supabase, planIds);
    return <MembershipShell staff={staff} query={query} filter={filter} clientId={clientId}
      page={page} total={filtered.length} groups={visible} plans={plans} />;
  } catch {
    return <Notice text="No fue posible cargar las membresías. Comprueba tu conexión e inténtalo de nuevo." />;
  }
}

function MembershipShell({ staff, query, filter, clientId, page, total, groups, plans }: {
  staff: boolean; query: string; filter: MembershipFilter; clientId: string; page: number; total: number;
  groups: ClientMembershipGroup<FinancialMembership | OperationalMembership>[];
  plans: Map<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const url = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter) params.set("filtro", filter);
    if (clientId) params.set("cliente", clientId);
    if (target > 1) params.set("pagina", String(target));
    return `/membresias?${params}`;
  };
  return <main className="portal-page">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="eyebrow">Operación Gólgota</p><h1 className="page-title mt-2">Membresías</h1>
        <p className="mt-2 text-sm text-brand-secondary">Un resumen por cliente, con su historial completo al abrirlo.</p></div>
      {!staff && <Link className="btn-primary" href={clientId ? `/membresias/nueva?cliente=${clientId}` : "/membresias/nueva"}>Nueva membresía</Link>}
    </div>
    <form action="/membresias" className="panel mt-7 grid items-end gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:p-5" role="search">
      {clientId && <input type="hidden" name="cliente" value={clientId} />}
      <div><label htmlFor="member-search" className="field-label">Buscar cliente</label>
        <input id="member-search" name="q" type="search" className="field" defaultValue={query} placeholder="Nombre o identificación" /></div>
      <div><label htmlFor="member-filter" className="field-label">Filtro</label>
        <select id="member-filter" name="filtro" className="field" defaultValue={filter}>
          {(staff ? staffFilters : financialFilters).map((value) => <option key={value} value={value}>{filterLabels[value]}</option>)}
        </select></div>
      <button type="submit" className="btn-secondary">Filtrar</button>
    </form>
    <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-secondary">
      <p role="status">{total.toLocaleString("es-EC")} {total === 1 ? "cliente" : "clientes"}</p>
      {(query || filter || clientId) && <Link href="/membresias" className="underline underline-offset-4">Limpiar filtros</Link>}
    </div>
    {!groups.length ? <div className="panel p-10 text-center text-brand-secondary">No hay clientes con membresías para estos filtros.</div>
      : <div className="grid gap-3">{groups.map((group) => <ClientCard key={group.client.id} group={group} staff={staff} plans={plans} />)}</div>}
    {pages > 1 && <nav aria-label="Páginas de clientes con membresía" className="mt-6 flex items-center justify-between gap-3 text-sm">
      <span>Página {page} de {pages}</span><div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary" href={url(page - 1)}>Anterior</Link>}
        {page < pages && <Link className="btn-secondary" href={url(page + 1)}>Siguiente</Link>}
      </div>
    </nav>}
  </main>;
}

function ClientCard({ group, staff, plans }: {
  group: ClientMembershipGroup<FinancialMembership | OperationalMembership>;
  staff: boolean; plans: Map<string, string>;
}) {
  const item = group.overview;
  const state = item ? vigencyOf(item) : null;
  const plan = item ? ("plan_id" in item ? plans.get(item.plan_id) ?? "Plan no disponible" : item.plan) : "Sin membresía no cancelada";
  return <article className="panel p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold text-brand-text">{group.client.nombre_completo}</h2>
        <p className="mt-1 text-sm text-brand-secondary">Identificación · {group.client.cedula}</p></div>
      {state && <VigencyBadge state={state} />}
    </div>
    <dl className={`mt-5 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 ${staff ? "lg:grid-cols-3" : "lg:grid-cols-6"}`}>
      <Metric label="Plan actual" value={plan} />
      <Metric label="Inicio" value={item ? displayDate(item.fecha_inicio) : "—"} />
      <Metric label="Vencimiento" value={item ? displayDate(item.fecha_fin) : "—"} />
      <Metric label="Vigencia" value={state ? vigencyLabel(state) : "Sin membresía"} />
      {!staff && <Metric label="Estado de pago" value={item && "estado_pago" in item ? item.estado_pago : "—"} />}
      {!staff && <Metric label="Saldo pendiente" value={item && "saldo" in item ? moneyLabel(Number(item.saldo)) : "—"} />}
    </dl>
    <Link className="btn-secondary mt-5" href={`/membresias/cliente/${group.client.id}`}>Ver historial del cliente</Link>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 font-medium text-brand-text">{value}</dd></div>;
}
function Notice({ text }: { text: string }) {
  return <main className="portal-page"><h1 className="page-title">Membresías</h1>
    <div className="panel mt-6 p-6" role="alert">{text}</div></main>;
}
