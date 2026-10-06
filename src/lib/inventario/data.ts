import "server-only";
import type { getInventoryAccess } from "./access";
import {
  canManageInventory, inventorySearchFilter, type InventoryIncidentRow,
  type InventoryManagementRow, type InventoryOperationalRow,
} from "./model";

type Access = NonNullable<Awaited<ReturnType<typeof getInventoryAccess>>>;
export type InventoryFilters = { query: string; state: string };

export async function loadInventory(access: Access, filters: InventoryFilters) {
  const canManage = canManageInventory(access.role);
  if (canManage) {
    let request = access.supabase.from("v_inventario_gestion")
      .select("id,nombre,categoria,cantidad,estado,fecha_compra,costo,ubicacion,observacion,created_by,updated_by,created_at,updated_at")
      .order("nombre").order("id").limit(2000);
    if (filters.query) request = request.or(inventorySearchFilter(filters.query));
    if (filters.state) request = request.eq("estado", filters.state);
    const [itemsResult, incidentsResult] = await Promise.all([
      request,
      access.supabase.from("inventario_incidencias")
        .select("id,inventario_item_id,tipo,observacion,reportado_por,fecha,estado,resuelto_por,resuelto_at")
        .order("fecha", { ascending: false }).limit(1000),
    ]);
    if (itemsResult.error || !itemsResult.data || incidentsResult.error || !incidentsResult.data) throw new Error("No se pudo cargar el inventario.");
    return { items: itemsResult.data as InventoryManagementRow[], incidents: incidentsResult.data as InventoryIncidentRow[], canManage: true };
  }
  let request = access.supabase.from("v_inventario_operativo")
    .select("id,nombre,categoria,cantidad,estado,ubicacion,observacion,updated_at")
    .order("nombre").order("id").limit(2000);
  if (filters.query) request = request.or(inventorySearchFilter(filters.query));
  if (filters.state) request = request.eq("estado", filters.state);
  const [itemsResult, incidentsResult] = await Promise.all([
    request,
    access.supabase.from("inventario_incidencias")
      .select("id,inventario_item_id,tipo,observacion,reportado_por,fecha,estado,resuelto_por,resuelto_at")
      .eq("reportado_por", access.userId).order("fecha", { ascending: false }).limit(500),
  ]);
  if (itemsResult.error || !itemsResult.data || incidentsResult.error || !incidentsResult.data) throw new Error("No se pudo cargar el inventario.");
  return { items: itemsResult.data as InventoryOperationalRow[], incidents: incidentsResult.data as InventoryIncidentRow[], canManage: false };
}
