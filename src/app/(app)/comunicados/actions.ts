"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCoachAccess } from "@/lib/coaches/access";
import { announcementSchema, canManageCoachContent, type CoachContentResult } from "@/lib/coaches/model";

const idSchema = z.string().uuid();

export async function saveAnnouncement(id: string | null, input: unknown): Promise<CoachContentResult> {
  try {
    const access = await getCoachAccess();
    if (!access || !canManageCoachContent(access.role)) {
      return { ok: false, message: "No tienes permiso para administrar comunicados." };
    }
    if (id !== null && !idSchema.safeParse(id).success) {
      return { ok: false, message: "El comunicado indicado no es válido." };
    }
    const parsed = announcementSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    }

    const result = id
      ? await access.supabase.from("comunicados").update(parsed.data).eq("id", id).select("id").single()
      : await access.supabase.from("comunicados").insert({ ...parsed.data, created_by: access.userId }).select("id").single();
    if (result.error || !result.data) {
      return { ok: false, message: "No fue posible guardar el comunicado. Revisa los datos y tus permisos." };
    }

    revalidatePath("/comunicados");
    revalidatePath("/");
    return { ok: true, id: result.data.id, message: id ? "Comunicado actualizado." : "Comunicado creado." };
  } catch {
    return { ok: false, message: "No fue posible completar la operación." };
  }
}

export async function manageAnnouncementLifecycle(id: string, action: "ELIMINAR" | "RESTAURAR"): Promise<CoachContentResult> {
  try {
    const access = await getCoachAccess();
    if (!access || !["admin", "owner"].includes(access.role)) return { ok: false, message: "No tienes permiso para retirar comunicados." };
    if (!idSchema.safeParse(id).success) return { ok: false, message: "El comunicado indicado no es válido." };
    const { data, error } = await access.supabase.rpc("gestionar_comunicado_seguro", { p_comunicado_id: id, p_accion: action });
    if (error || !data || typeof data !== "object") return { ok: false, message: "No fue posible completar el ciclo de vida del comunicado." };
    const mode = (data as { modo?: string }).modo;
    revalidatePath("/comunicados"); revalidatePath("/");
    return { ok: true, id, message: action === "RESTAURAR" ? "Comunicado restaurado como borrador."
      : mode === "FISICA" ? "El comunicado fue eliminado definitivamente." : "El comunicado fue archivado y dejó de mostrarse al alumno." };
  } catch { return { ok: false, message: "No fue posible completar el ciclo de vida del comunicado." }; }
}
