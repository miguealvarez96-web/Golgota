import "server-only";

import type { getCoachAccess } from "./access";
import type { AnnouncementRow, WodRow } from "./model";

type Database = NonNullable<Awaited<ReturnType<typeof getCoachAccess>>>["supabase"];

export type CoachMembershipAlert = {
  membresia_id: string;
  cliente_id: string;
  cliente: string;
  plan: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado_vigencia: "POR_VENCER" | "VENCE_HOY" | "VENCIDA";
};

export type CoachDashboardData = {
  expiring: CoachMembershipAlert[];
  expired: CoachMembershipAlert[];
  wod: WodRow | null;
  announcements: AnnouncementRow[];
};

export async function loadCoachDashboard(supabase: Database, today: string): Promise<CoachDashboardData> {
  const [expiringResult, expiredResult, wodResult, announcementsResult] = await Promise.all([
    supabase.from("v_membresias_verificacion")
      .select("membresia_id,cliente_id,plan,fecha_inicio,fecha_fin,estado_vigencia")
      .in("estado_vigencia", ["POR_VENCER", "VENCE_HOY"])
      .order("fecha_fin", { ascending: true })
      .limit(12),
    supabase.from("v_membresias_verificacion")
      .select("membresia_id,cliente_id,plan,fecha_inicio,fecha_fin,estado_vigencia")
      .eq("estado_vigencia", "VENCIDA")
      .order("fecha_fin", { ascending: false })
      .limit(40),
    supabase.from("wods")
      .select("id,fecha,titulo,contenido,horario_grupo,youtube_url,notas,publicado,created_by,created_at,updated_at")
      .eq("fecha", today)
      .eq("publicado", true)
      .maybeSingle(),
    supabase.from("comunicados")
      .select("id,titulo,contenido,publicado,fecha_publicacion,created_by,created_at,updated_at")
      .eq("publicado", true)
      .lte("fecha_publicacion", new Date().toISOString())
      .order("fecha_publicacion", { ascending: false, nullsFirst: false })
      .limit(3),
  ]);

  if (expiringResult.error || expiredResult.error || wodResult.error || announcementsResult.error) {
    throw new Error("No se pudo cargar el panel operativo.");
  }

  const expiredLatest = new Map<string, (typeof expiredResult.data)[number]>();
  for (const membership of expiredResult.data ?? []) {
    if (!expiredLatest.has(membership.cliente_id)) expiredLatest.set(membership.cliente_id, membership);
  }
  const operational = [...(expiringResult.data ?? []), ...Array.from(expiredLatest.values()).slice(0, 8)];
  const clientIds = Array.from(new Set(operational.map((membership) => membership.cliente_id)));
  const clients = new Map<string, { nombre_completo: string }>();
  if (clientIds.length) {
    const { data, error } = await supabase.from("clientes")
      .select("id,nombre_completo")
      .in("id", clientIds);
    if (error) throw new Error("No se pudieron cargar los alumnos del panel.");
    for (const client of data ?? []) clients.set(client.id, client);
  }

  const alerts = operational.flatMap((membership) => {
    const client = clients.get(membership.cliente_id);
    if (!client) return [];
    return [{
      ...membership,
      cliente: client.nombre_completo,
    } as CoachMembershipAlert];
  });

  return {
    expiring: alerts.filter((item) => item.estado_vigencia !== "VENCIDA").slice(0, 8),
    expired: alerts.filter((item) => item.estado_vigencia === "VENCIDA").slice(0, 8),
    wod: (wodResult.data as WodRow | null) ?? null,
    announcements: (announcementsResult.data ?? []) as AnnouncementRow[],
  };
}
