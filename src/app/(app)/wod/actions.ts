"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCoachAccess } from "@/lib/coaches/access";
import { canManageWodContent, wodSchema, type CoachContentResult } from "@/lib/coaches/model";

const idSchema = z.string().uuid();

export async function saveWod(id: string | null, input: unknown): Promise<CoachContentResult> {
  try {
    const access = await getCoachAccess();
    if (!access || !canManageWodContent(access.role)) {
      return { ok: false, message: "No tienes permiso para administrar el WOD." };
    }
    if (id !== null && !idSchema.safeParse(id).success) {
      return { ok: false, message: "El WOD indicado no es válido." };
    }
    const parsed = wodSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    }
    const payload = {
      fecha: parsed.data.fecha,
      titulo: parsed.data.titulo,
      contenido: parsed.data.descripcion,
      horario_grupo: parsed.data.horario_grupo,
      youtube_url: parsed.data.youtube_url,
      notas: parsed.data.notas,
      benchmark_ref: parsed.data.benchmark_ref,
      permite_resultados: parsed.data.permite_resultados,
      limite_tiempo_minutos: parsed.data.limite_tiempo_minutos,
      publicado: parsed.data.publicado,
    };

    const result = id
      ? await access.supabase.from("wods").update(payload).eq("id", id).select("id").single()
      : await access.supabase.from("wods").insert({ ...payload, created_by: access.userId }).select("id").single();
    if (result.error || !result.data) {
      const duplicateDate = result.error?.code === "23505";
      return { ok: false, message: duplicateDate
        ? "Ya existe un WOD para esa fecha. Edita el registro existente."
        : "No fue posible guardar el WOD. Revisa los datos y tus permisos." };
    }

    revalidatePath("/wod");
    revalidatePath("/");
    return { ok: true, id: result.data.id, message: id ? "WOD actualizado." : "WOD creado." };
  } catch {
    return { ok: false, message: "No fue posible completar la operación." };
  }
}

export async function manageWodLifecycle(id: string, action: "ELIMINAR" | "RESTAURAR"): Promise<CoachContentResult> {
  try {
    const access = await getCoachAccess();
    if (!access || !["admin", "owner"].includes(access.role)) return { ok: false, message: "No tienes permiso para retirar WOD." };
    if (!idSchema.safeParse(id).success) return { ok: false, message: "El WOD indicado no es válido." };
    const { data, error } = await access.supabase.rpc("gestionar_wod_seguro", { p_wod_id: id, p_accion: action });
    if (error || !data || typeof data !== "object") return { ok: false, message: "No fue posible completar el ciclo de vida del WOD." };
    const mode = (data as { modo?: string }).modo;
    revalidatePath("/wod"); revalidatePath("/portal"); revalidatePath("/");
    return { ok: true, id, message: action === "RESTAURAR" ? "WOD restaurado como borrador."
      : mode === "FISICA" ? "El WOD fue eliminado definitivamente." : "El WOD fue archivado y sus resultados se conservan." };
  } catch { return { ok: false, message: "No fue posible completar el ciclo de vida del WOD." }; }
}
