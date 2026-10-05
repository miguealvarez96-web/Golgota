"use server";

import { revalidatePath } from "next/cache";
import { getStudentAccess } from "@/lib/alumnos/access";
import {
  acceptPrivacySchema,
  createPrivacyRequestSchema,
  type PrivacyActionResult,
} from "@/lib/privacidad/model";

export async function acceptPrivacyNotice(input: unknown): Promise<PrivacyActionResult> {
  try {
    const parsed = acceptPrivacySchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la aceptación." };
    const access = await getStudentAccess();
    if (!access) return { ok: false, message: "No tienes permiso para registrar esta aceptación." };
    const { error } = await access.supabase.rpc("registrar_aceptacion_privacidad", {
      p_aviso_version: parsed.data.aviso_version,
      p_contexto: "PORTAL_ALUMNO",
      p_comunicaciones_promocionales: parsed.data.comunicaciones_promocionales,
    });
    if (error) return { ok: false, message: ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)
      ? "Primero debe aplicarse la migración del BLOQUE 6."
      : "No fue posible registrar la aceptación." };
    revalidatePath("/portal");
    return { ok: true, message: "Tu aceptación quedó registrada con fecha y versión." };
  } catch {
    return { ok: false, message: "No fue posible registrar la aceptación." };
  }
}

export async function createPrivacyRequest(input: unknown): Promise<PrivacyActionResult> {
  try {
    const parsed = createPrivacyRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la solicitud." };
    const access = await getStudentAccess();
    if (!access) return { ok: false, message: "No tienes permiso para crear esta solicitud." };
    const { error } = await access.supabase.rpc("crear_solicitud_privacidad", {
      p_tipo: parsed.data.tipo,
      p_descripcion: parsed.data.descripcion,
    });
    if (error) return { ok: false, message: ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code)
      ? "Primero debe aplicarse la migración del BLOQUE 6."
      : "No fue posible registrar la solicitud." };
    revalidatePath("/portal");
    revalidatePath("/solicitudes-privacidad");
    return { ok: true, message: "Solicitud recibida. Su atención requiere revisión humana." };
  } catch {
    return { ok: false, message: "No fue posible registrar la solicitud." };
  }
}
