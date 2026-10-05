"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCoachAccess } from "@/lib/coaches/access";
import { canManageCoachContent, wodSchema, type CoachContentResult } from "@/lib/coaches/model";

const idSchema = z.string().uuid();

export async function saveWod(id: string | null, input: unknown): Promise<CoachContentResult> {
  try {
    const access = await getCoachAccess();
    if (!access || !canManageCoachContent(access.role)) {
      return { ok: false, message: "No tienes permiso para administrar el WOD." };
    }
    if (id !== null && !idSchema.safeParse(id).success) {
      return { ok: false, message: "El WOD indicado no es válido." };
    }
    const parsed = wodSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    }

    const result = id
      ? await access.supabase.from("wods").update(parsed.data).eq("id", id).select("id").single()
      : await access.supabase.from("wods").insert({ ...parsed.data, created_by: access.userId }).select("id").single();
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

