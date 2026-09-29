import ClientsManager from "@/components/clientes/clients-manager";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients, clientStates, clientSearchFilter, type ClientRow, type MembershipSummary } from "@/lib/clientes/model";

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
    let request = access.supabase.from("clientes")
      .select("id,nombre_completo,cedula,celular,email,estado_cliente,fecha_registro", { count: "exact" })
      .order("nombre_completo").order("id").range((page - 1) * pageSize, page * pageSize - 1);
    if (query) request = request.or(clientSearchFilter(query));
    if (state) request = request.eq("estado_cliente", state);
    const { data, count, error } = await request;
    if (error || !data || count === null) return <ClientLoadError message="No fue posible cargar los clientes. Inténtalo de nuevo." />;

    const memberships: Record<string, MembershipSummary> = {};
    const canEdit = canManageClients(access.role);
    let membershipError = false;
    if (canEdit && data.length) {
      // Staff nunca consulta esta vista ni recibe datos de membresías/pagos.
      // No se seleccionan importes ni estado de deuda para el listado.
      const current = await access.supabase.from("v_membresias_estado")
        .select("id,cliente_id,estado_vigencia,fecha_fin", { count: "exact" })
        .in("cliente_id", data.map((client) => client.id))
        .neq("estado_pago", "CANCELADA")
        .in("estado_vigencia", ["VIGENTE", "POR_VENCER", "VENCE_HOY"])
        .order("fecha_fin", { ascending: false });
      membershipError = Boolean(current.error) || current.count === null || current.count !== current.data?.length;
      if (!membershipError) {
        for (const membership of current.data ?? []) {
          memberships[membership.cliente_id] ??= { id: membership.id, estado_vigencia: membership.estado_vigencia, fecha_fin: membership.fecha_fin };
        }
      }
    }
    return <ClientsManager clients={data as ClientRow[]} total={count} page={page} pageSize={pageSize}
      query={query} state={state} canEdit={canEdit} memberships={memberships} membershipError={membershipError} />;
  } catch {
    return <ClientLoadError message="No fue posible conectar con el listado de clientes. Inténtalo de nuevo." />;
  }
}

function ClientLoadError({ message }: { message: string }) {
  return <main className="portal-page"><h1 className="page-title">Clientes</h1>
    <div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">{message}</p>
      <a href="/clientes" className="btn-secondary mt-4">Volver a cargar</a></div></main>;
}
