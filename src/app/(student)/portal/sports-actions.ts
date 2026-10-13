"use server";

import { revalidatePath } from "next/cache";

import { getStudentAccess } from "@/lib/alumnos/access";
import {
  challengeProgressSchema,
  parseWodTime,
  personalRecordSchema,
  physicalProgressSchema,
  wodResultSchema,
  type SportActionResult,
} from "@/lib/deportivo/model";

async function studentRpc(name: string, args: Record<string, unknown>, success: string): Promise<SportActionResult> {
  const access = await getStudentAccess();
  if (!access) return { ok: false, message: "No tienes permiso para realizar esta acción." };
  const { error } = await access.supabase.rpc(name, args);
  if (error) return { ok: false, message: "No fue posible guardar la información. Revisa los datos e inténtalo de nuevo." };
  revalidatePath("/portal");
  return { ok: true, message: success };
}

export async function savePhysicalProgress(input: unknown): Promise<SportActionResult> {
  const parsed = physicalProgressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  return studentRpc("registrar_progreso_fisico", {
    p_fecha: parsed.data.fecha, p_peso_kg: parsed.data.peso_kg, p_estatura_m: parsed.data.estatura_m,
  }, "Progreso registrado.");
}

export async function savePersonalRecord(input: unknown): Promise<SportActionResult> {
  const parsed = personalRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  return studentRpc("registrar_record_personal", {
    p_ejercicio: parsed.data.ejercicio,
    p_nombre_personalizado: parsed.data.nombre_personalizado,
    p_valor: parsed.data.valor,
    p_unidad: parsed.data.unidad,
    p_fecha: parsed.data.fecha,
    p_observacion: parsed.data.observacion || null,
  }, "Récord registrado.");
}

export async function saveWodResult(input: unknown): Promise<SportActionResult> {
  const parsed = wodResultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa el tiempo." };
  const seconds = parseWodTime(parsed.data.tiempo);
  if (!seconds) return { ok: false, message: "Usa MM:SS o HH:MM:SS con un tiempo válido." };
  return studentRpc("registrar_resultado_wod", {
    p_wod_id: parsed.data.wod_id, p_tiempo_segundos: seconds,
  }, "Tiempo registrado.");
}

export async function joinChallenge(challengeId: string): Promise<SportActionResult> {
  const parsed = challengeProgressSchema.shape.desafio_id.safeParse(challengeId);
  if (!parsed.success) return { ok: false, message: "El desafío no es válido." };
  return studentRpc("unirse_desafio", { p_desafio_id: parsed.data }, "Te uniste al desafío.");
}

export async function updateStudentChallengeProgress(input: unknown): Promise<SportActionResult> {
  const parsed = challengeProgressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El progreso no es válido." };
  return studentRpc("actualizar_progreso_desafio_alumno", {
    p_desafio_id: parsed.data.desafio_id, p_progreso: parsed.data.progreso,
  }, "Progreso actualizado.");
}
