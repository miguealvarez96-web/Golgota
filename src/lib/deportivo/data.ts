import "server-only";

import type { getCoachAccess } from "@/lib/coaches/access";
import type { getStudentAccess } from "@/lib/alumnos/access";
import { studentSportDataSchema, type ChallengeState, type SportExercise, type SportUnit } from "./model";

type StudentAccess = NonNullable<Awaited<ReturnType<typeof getStudentAccess>>>;
type CoachAccess = NonNullable<Awaited<ReturnType<typeof getCoachAccess>>>;

export async function loadStudentSportData(access: StudentAccess) {
  const result = await access.supabase.rpc("obtener_deportivo_alumno");
  if (result.error) return { data: null, error: "Las funciones deportivas estarán disponibles cuando se aplique la migración preparada." };
  const parsed = studentSportDataSchema.safeParse(result.data);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: "No fue posible validar la información deportiva." };
}

export type CoachSportResult = {
  wod_id: string; fecha: string; wod: string; nombre_visible: string;
  tiempo_segundos: number; posicion: number;
};
export type CoachSportRecord = {
  usuario_id: string; nombre_visible: string; ejercicio: SportExercise;
  nombre_personalizado: string | null; valor: number; unidad: SportUnit; fecha: string;
};
export type ChallengeParticipant = {
  usuario_id: string; nombre_visible: string; progreso: number;
  porcentaje: number; completed_at: string | null;
};
export type ManagedChallenge = {
  id: string; titulo: string; descripcion: string; fecha_inicio: string; fecha_fin: string;
  objetivo_numero: number; unidad: string; estado: ChallengeState; participantes: ChallengeParticipant[];
  archivado: boolean;
};

export async function loadCoachSportOverview(access: CoachAccess) {
  const result = await access.supabase.rpc("listar_panel_deportivo_coach");
  if (result.error || !result.data || typeof result.data !== "object") return { resultados: [], records: [] };
  const value = result.data as { resultados?: CoachSportResult[]; records?: CoachSportRecord[] };
  return { resultados: value.resultados ?? [], records: value.records ?? [] };
}

export async function loadManagedChallenges(access: CoachAccess): Promise<ManagedChallenge[]> {
  const result = await access.supabase.rpc("listar_desafios_gestion");
  return result.error || !Array.isArray(result.data) ? [] : result.data as ManagedChallenge[];
}
