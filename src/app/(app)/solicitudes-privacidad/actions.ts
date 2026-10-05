"use server";

import { revalidatePath } from "next/cache";
import { getPrivacyManagementAccess } from "@/lib/privacidad/access";
import { reviewPrivacyRequestSchema, type PrivacyActionResult } from "@/lib/privacidad/model";

export async function reviewPrivacyRequest(input: unknown): Promise<PrivacyActionResult> {
  try {
    const parsed = reviewPrivacyRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la respuesta." };
    const access = await getPrivacyManagementAccess();
    if (!access) return { ok: false, message: "No tienes permiso para gestionar solicitudes de privacidad." };
    const { error } = await access.supabase.rpc("revisar_solicitud_privacidad", {
      p_solicitud_id: parsed.data.solicitud_id,
      p_estado: parsed.data.estado,
      p_respuesta: parsed.data.respuesta || null,
    });
    if (error) return { ok: false, message: error.code === "55000"
      ? "La solicitud ya fue cerrada."
      : ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)
        ? "Primero debe aplicarse la migración del BLOQUE 6."
        : "No fue posible actualizar la solicitud." };
    revalidatePath("/solicitudes-privacidad");
    revalidatePath("/portal");
    return { ok: true, message: "Solicitud actualizada con trazabilidad de revisión." };
  } catch {
    return { ok: false, message: "No fue posible actualizar la solicitud." };
  }
}
