import ClientsManager from "@/components/clientes/clients-manager";
import { getClientAccess } from "@/lib/clientes/access";
import { businessDate, canManageClients, clientStates, clientSearchFilter, type ClientListRow, type MembershipSummary } from "@/lib/clientes/model";
import { chooseOverview, type OperationalMembership } from "@/lib/membresias/grouping";

export default async function ClientesPage({ searchParams }: {
  searchParams: { q?: string; estado?: string; pagina?: string };
}) {
  const query = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const state = clientStates.find((value) => value === searchParams.estado) ?? "";
  const requestedPage = Number(searchParams.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000000) : 1;
  const pageSize = 20;

  try {
    const access = await getClientAccess();
    if (!access) return <ClientLoadError message="Tu sesión no permite consultar clientes. Vuelve a iniciar sesión." />;
    const staff = access.role === "staff";
    const { data, count, error } = await loadClients(access.supabase, staff, query, state, page, pageSize);
    if (error || !data || count === null) return <ClientLoadError message="No fue posible cargar los clientes. Inténtalo de nuevo." />;

    const memberships: Record<string, MembershipSummary> = {};
    const canEdit = canManageClients(access.role);
    let membershipError = false;
    if (data.length) {
      // Proyección operativa aislada: no contiene importes, pagos ni saldos.
      const current = await access.supabase.from("v_membresias_verificacion")
        .select("membresia_id,cliente_id,plan,fecha_inicio,fecha_fin,estado_vigencia", { count: "exact" })
        .in("cliente_id", data.map((client: { id: string }) => client.id))
        .order("fecha_fin", { ascending: true });
      membershipError = Boolean(current.error) || current.count === null || current.count !== current.data?.length;
      if (!membershipError) {
        for (const client of data) {
          const rows = (current.data ?? []).filter((row) => row.cliente_id === client.id) as (OperationalMembership & { membresia_id: string })[];
          const membership = chooseOverview(rows);
          if (membership) memberships[client.id] = {
            id: membership.membresia_id,
            plan: membership.plan,
            fecha_inicio: membership.fecha_inicio,
            fecha_fin: membership.fecha_fin,
            estado_vigencia: membership.estado_vigencia ?? "POR_INICIAR",
            dias_restantes: remainingDays(membership.fecha_fin, businessDate()),
          };
        }
      }
    }
    return <ClientsManager clients={data as ClientListRow[]} total={count} page={page} pageSize={pageSize}
      query={query} state={state} canEdit={canEdit} memberships={memberships} membershipError={membershipError} />;
  } catch {
    return <ClientLoadError message="No fue posible conectar con el listado de clientes. Inténtalo de nuevo." />;
  }
}

type ClientDatabase = NonNullable<Awaited<ReturnType<typeof getClientAccess>>>["supabase"];

async function loadClients(supabase: ClientDatabase, staff: boolean, query: string, state: string, page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;
  if (staff) {
    let request = supabase.from("clientes").select("id,nombre_completo,estado_cliente", { count: "exact" })
      .order("nombre_completo").order("id").range(from, to);
    if (query) request = request.ilike("nombre_completo", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    if (state) request = request.eq("estado_cliente", state);
    return request;
  }
  let request = supabase.from("clientes")
    .select("id,nombre_completo,cedula,celular,email,estado_cliente,fecha_registro", { count: "exact" })
    .order("nombre_completo").order("id").range(from, to);
  if (query) request = request.or(clientSearchFilter(query));
  if (state) request = request.eq("estado_cliente", state);
  return request;
}

function remainingDays(end: string, today: string) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

function ClientLoadError({ message }: { message: string }) {
  return <main className="portal-page"><h1 className="page-title">Clientes</h1>
    <div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">{message}</p>
      <a href="/clientes" className="btn-secondary mt-4">Volver a cargar</a></div></main>;
}
