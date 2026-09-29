export type Vigency = "POR_INICIAR" | "VIGENTE" | "POR_VENCER" | "VENCE_HOY" | "VENCIDA";
export type MembershipFilter = "" | "vigentes" | "por_vencer" | "vencidas" | "saldo_pendiente" | "pagadas";
export type MembershipBase = { cliente_id: string; fecha_fin: string; estado_vigencia: string | null };
export type FinancialMembership = MembershipBase & {
  id: string; plan_id: string; fecha_inicio: string; saldo: number; estado_pago: string;
};
export type OperationalMembership = MembershipBase & { plan: string };
export type ClientIdentity = { id: string; nombre_completo: string; cedula: string };
export type ClientMembershipGroup<T extends MembershipBase> = {
  client: ClientIdentity; memberships: T[]; overview: T | null;
};

const priority: Record<Vigency, number> = {
  VENCIDA: 0, VENCE_HOY: 1, POR_VENCER: 2, VIGENTE: 3, POR_INICIAR: 4,
};

export function vigencyOf(row: MembershipBase): Vigency {
  return row.estado_vigencia === "VIGENTE" || row.estado_vigencia === "POR_VENCER"
    || row.estado_vigencia === "VENCE_HOY" || row.estado_vigencia === "VENCIDA"
    ? row.estado_vigencia : "POR_INICIAR";
}

export function vigencyLabel(value: Vigency): string { return value.replaceAll("_", " "); }

export function chooseOverview<T extends MembershipBase>(rows: T[]): T | null {
  const available = rows.filter((row) => !("estado_pago" in row) || row.estado_pago !== "CANCELADA");
  const active = available.filter((row) => ["VIGENTE", "POR_VENCER", "VENCE_HOY"].includes(vigencyOf(row)))
    .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin));
  if (active.length) return active[0];
  const expired = available.filter((row) => vigencyOf(row) === "VENCIDA")
    .sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin));
  if (expired.length) return expired[0];
  const future = available.filter((row) => vigencyOf(row) === "POR_INICIAR")
    .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin));
  return future[0] ?? null;
}

export function groupByClient<T extends MembershipBase>(rows: T[], clients: Map<string, ClientIdentity>) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.cliente_id) ?? [];
    list.push(row);
    grouped.set(row.cliente_id, list);
  }
  const groups: ClientMembershipGroup<T>[] = [];
  grouped.forEach((memberships, id) => {
    const client = clients.get(id);
    if (client) groups.push({ client, memberships, overview: chooseOverview(memberships) });
  });
  return groups.sort((a, b) => {
    const aRank = a.overview ? priority[vigencyOf(a.overview)] : 5;
    const bRank = b.overview ? priority[vigencyOf(b.overview)] : 5;
    if (aRank !== bRank) return aRank - bRank;
    if (a.overview && b.overview) {
      const dateOrder = aRank === 0
        ? b.overview.fecha_fin.localeCompare(a.overview.fecha_fin)
        : a.overview.fecha_fin.localeCompare(b.overview.fecha_fin);
      if (dateOrder) return dateOrder;
    }
    return a.client.nombre_completo.localeCompare(b.client.nombre_completo, "es");
  });
}

export function filterClientGroups<T extends MembershipBase>(groups: ClientMembershipGroup<T>[], query: string, filter: MembershipFilter) {
  const needle = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  return groups.filter(({ client, overview }) => {
    const name = client.nombre_completo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    if (needle && !name.includes(needle) && !client.cedula.includes(query)) return false;
    if (!filter) return true;
    if (!overview) return false;
    const state = vigencyOf(overview);
    if (filter === "vigentes") return ["VIGENTE", "POR_VENCER", "VENCE_HOY"].includes(state);
    if (filter === "por_vencer") return state === "POR_VENCER";
    if (filter === "vencidas") return state === "VENCIDA";
    if (filter === "saldo_pendiente") return "saldo" in overview && Number(overview.saldo) > 0;
    return "estado_pago" in overview && overview.estado_pago === "PAGADO";
  });
}
