"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getInventoryAccess } from "@/lib/inventario/access";
import { canManageInventory, canViewInventory, inventoryIncidentSchema, inventoryItemSchema, inventoryStates, type InventoryResult } from "@/lib/inventario/model";

const idSchema = z.string().uuid();

export async function saveInventoryItem(id: string | null, input: unknown): Promise<InventoryResult> {
  try {
    const access = await getInventoryAccess();
    if (!access || !canManageInventory(access.role)) return { ok: false, message: "No tienes permiso para administrar inventario." };
    if (id !== null && !idSchema.safeParse(id).success) return { ok: false, message: "El item indicado no es válido." };
    const parsed = inventoryItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    const result = id
      ? await access.supabase.from("inventario_items").update(parsed.data).eq("id", id).select("id").single()
      : await access.supabase.from("inventario_items").insert({ ...parsed.data, created_by: access.userId }).select("id").single();
    if (result.error || !result.data) return { ok: false, message: "No fue posible guardar el item. Revisa los datos y tus permisos." };
    revalidatePath("/inventario"); revalidatePath("/reportes");
    return { ok: true, id: result.data.id, message: id ? "Item actualizado." : "Item creado." };
  } catch {
    return { ok: false, message: "No fue posible completar la operación." };
  }
}

export async function reportInventoryIncident(input: unknown): Promise<InventoryResult> {
  try {
    const access = await getInventoryAccess();
    if (!access || !canViewInventory(access.role)) return { ok: false, message: "No tienes permiso para reportar incidencias." };
    const parsed = inventoryIncidentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    const { data, error } = await access.supabase.from("inventario_incidencias")
      .insert({ ...parsed.data, reportado_por: access.userId }).select("id").single();
    if (error || !data) return { ok: false, message: "No fue posible registrar la incidencia." };
    revalidatePath("/inventario");
    return { ok: true, id: data.id, message: "Incidencia reportada." };
  } catch {
    return { ok: false, message: "No fue posible registrar la incidencia." };
  }
}

export async function resolveInventoryIncident(id: string, itemState?: string): Promise<InventoryResult> {
  try {
    const access = await getInventoryAccess();
    if (!access || !canManageInventory(access.role)) return { ok: false, message: "No tienes permiso para resolver incidencias." };
    if (!idSchema.safeParse(id).success || (itemState !== undefined && !inventoryStates.includes(itemState as (typeof inventoryStates)[number]))) {
      return { ok: false, message: "La resolución solicitada no es válida." };
    }
    const { data, error } = await access.supabase.rpc("resolver_incidencia_inventario", {
      p_incidencia_id: id, p_estado_item: itemState ?? null,
    });
    if (error || !data) return { ok: false, message: "No fue posible resolver la incidencia o ya estaba resuelta." };
    revalidatePath("/inventario"); revalidatePath("/reportes");
    return { ok: true, id, message: "Incidencia resuelta." };
  } catch {
    return { ok: false, message: "No fue posible resolver la incidencia." };
  }
}
