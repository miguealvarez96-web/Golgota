"use server";

import { revalidatePath } from "next/cache";

import { getCoachAccess } from "@/lib/coaches/access";
import { challengeProgressSchema, challengeSchema, type SportActionResult } from "@/lib/deportivo/model";

export async function saveChallenge(input: unknown): Promise<SportActionResult> {
  const access = await getCoachAccess();
  if (!access) return { ok: false, message: "No tienes permiso para gestionar desafíos." };
  const parsed = challengeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const { error } = await access.supabase.rpc("guardar_desafio", {
    p_id: parsed.data.id,
    p_titulo: parsed.data.titulo,
    p_descripcion: parsed.data.descripcion,
    p_fecha_inicio: parsed.data.fecha_inicio,
    p_fecha_fin: parsed.data.fecha_fin,
    p_objetivo_numero: parsed.data.objetivo_numero,
    p_unidad: parsed.data.unidad,
    p_estado: parsed.data.estado,
  });
  if (error) return { ok: false, message: "No fue posible guardar el desafío." };
  revalidatePath("/desafios"); revalidatePath("/portal");
  return { ok: true, message: parsed.data.id ? "Desafío actualizado." : "Desafío creado." };
}

export async function updateCoachChallengeProgress(input: unknown): Promise<SportActionResult> {
  const parsed = challengeProgressSchema.extend({ usuario_id: challengeProgressSchema.shape.desafio_id }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa el progreso." };
  const access = await getCoachAccess();
  if (!access) return { ok: false, message: "No tienes permiso para actualizar participantes." };
  const { error } = await access.supabase.rpc("actualizar_progreso_desafio_coach", {
    p_desafio_id: parsed.data.desafio_id, p_usuario_id: parsed.data.usuario_id, p_progreso: parsed.data.progreso,
  });
  if (error) return { ok: false, message: "No fue posible actualizar el progreso." };
  revalidatePath("/desafios"); revalidatePath("/portal");
  return { ok: true, message: "Progreso validado." };
}

export async function manageChallengeLifecycle(id: string, action: "ELIMINAR" | "RESTAURAR"): Promise<SportActionResult> {
  const access = await getCoachAccess();
  if (!access || !["admin", "owner"].includes(access.role)) return { ok: false, message: "No tienes permiso para retirar desafíos." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "El desafío indicado no es válido." };
  const { data, error } = await access.supabase.rpc("gestionar_desafio_seguro", { p_desafio_id: id, p_accion: action });
  if (error || !data || typeof data !== "object") return { ok: false, message: "No fue posible completar el ciclo de vida del desafío." };
  const mode = (data as { modo?: string }).modo;
  revalidatePath("/desafios"); revalidatePath("/portal");
  return { ok: true, message: action === "RESTAURAR" ? "Desafío restaurado como borrador."
    : mode === "FISICA" ? "El desafío fue eliminado definitivamente." : "El desafío fue archivado y el progreso se conserva." };
}
