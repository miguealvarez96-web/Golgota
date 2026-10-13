import { z } from "zod";

import { businessDate } from "@/lib/clientes/model";

export const sportExercises = [
  "BACK_SQUAT", "FRONT_SQUAT", "DEADLIFT", "BENCH_PRESS",
  "CLEAN", "CLEAN_AND_JERK", "SNATCH", "PULL_UPS", "OTRO",
] as const;
export const sportUnits = ["KG", "REPETICIONES", "TIEMPO"] as const;
export const challengeStates = ["BORRADOR", "ACTIVO", "CERRADO"] as const;

export type SportExercise = (typeof sportExercises)[number];
export type SportUnit = (typeof sportUnits)[number];
export type ChallengeState = (typeof challengeStates)[number];

const todayOrEarlier = z.iso.date({ error: "Ingresa una fecha válida." })
  .refine((value) => value <= businessDate(), "La fecha no puede ser futura.");

export const physicalProgressSchema = z.object({
  fecha: todayOrEarlier,
  peso_kg: z.number().finite().min(20, "El peso debe ser de al menos 20 kg.").max(350, "El peso no puede superar 350 kg."),
  estatura_m: z.number().finite().min(0.8, "La estatura debe ser de al menos 0,80 m.").max(2.5, "La estatura no puede superar 2,50 m."),
}).strict();

export const personalRecordSchema = z.object({
  ejercicio: z.enum(sportExercises),
  nombre_personalizado: z.string().trim().max(100, "Máximo 100 caracteres.").nullable(),
  valor: z.number().finite().positive("El valor debe ser mayor que cero.").max(999999.99, "El valor es demasiado alto."),
  unidad: z.enum(sportUnits),
  fecha: todayOrEarlier,
  observacion: z.string().trim().max(500, "Máximo 500 caracteres."),
}).strict().superRefine((value, context) => {
  if (value.ejercicio === "OTRO" && !value.nombre_personalizado) {
    context.addIssue({ code: "custom", path: ["nombre_personalizado"], message: "Escribe el nombre del ejercicio." });
  }
  if (value.ejercicio !== "OTRO" && value.nombre_personalizado) {
    context.addIssue({ code: "custom", path: ["nombre_personalizado"], message: "El nombre personalizado solo corresponde a Otro." });
  }
});

export const wodResultSchema = z.object({
  wod_id: z.string().uuid(),
  tiempo: z.string().trim().min(1, "Ingresa tu tiempo."),
}).strict();

export const challengeSchema = z.object({
  id: z.string().uuid().nullable(),
  titulo: z.string().trim().min(1, "El título es obligatorio.").max(160, "Máximo 160 caracteres."),
  descripcion: z.string().trim().min(1, "La descripción es obligatoria.").max(3000, "Máximo 3000 caracteres."),
  fecha_inicio: z.iso.date(),
  fecha_fin: z.iso.date(),
  objetivo_numero: z.number().finite().positive("El objetivo debe ser mayor que cero.").max(999999, "El objetivo es demasiado alto."),
  unidad: z.string().trim().min(1, "La unidad es obligatoria.").max(80, "Máximo 80 caracteres."),
  estado: z.enum(challengeStates),
}).strict().refine((value) => value.fecha_fin >= value.fecha_inicio, {
  path: ["fecha_fin"], message: "La fecha final no puede ser anterior al inicio.",
});

export const challengeProgressSchema = z.object({
  desafio_id: z.string().uuid(),
  progreso: z.number().finite().nonnegative("El progreso no puede ser negativo."),
}).strict();

export const studentSportDataSchema = z.object({
  progreso: z.array(z.object({
    id: z.string().uuid(), fecha: z.string(), peso_kg: z.coerce.number(), estatura_m: z.coerce.number(),
    imc: z.coerce.number(), created_at: z.string(),
  })),
  records: z.array(z.object({
    id: z.string().uuid(), ejercicio: z.enum(sportExercises), nombre_personalizado: z.string().nullable(),
    valor: z.coerce.number(), unidad: z.enum(sportUnits), fecha: z.string(), observacion: z.string().nullable(), created_at: z.string(),
  })),
  wod_actual: z.object({
    id: z.string().uuid(), fecha: z.string(), titulo: z.string(), benchmark_ref: z.string().nullable(),
    permite_resultados: z.boolean(), limite_tiempo_minutos: z.coerce.number().int().positive().nullable(),
    mi_tiempo_segundos: z.coerce.number().int().positive().nullable(), mi_posicion: z.coerce.number().int().positive().nullable(),
    ranking: z.array(z.object({ posicion: z.coerce.number().int().positive(), nombre_visible: z.string(), tiempo_segundos: z.coerce.number().int().positive() })),
  }).nullable(),
  historial_wod: z.array(z.object({
    wod_id: z.string().uuid(), fecha: z.string(), titulo: z.string(), benchmark_ref: z.string().nullable(),
    tiempo_segundos: z.coerce.number().int().positive(), posicion: z.coerce.number().int().positive(),
    mejor_tiempo_segundos: z.coerce.number().int().positive(), nuevo_pr: z.boolean(),
  })),
  desafios: z.array(z.object({
    id: z.string().uuid(), titulo: z.string(), descripcion: z.string(), fecha_inicio: z.string(), fecha_fin: z.string(),
    objetivo_numero: z.coerce.number().positive(), unidad: z.string(), estado: z.enum(challengeStates),
    unido: z.boolean(), progreso: z.coerce.number().nonnegative(), porcentaje: z.coerce.number().min(0).max(100), completed_at: z.string().nullable(),
  })),
});

export type StudentSportData = z.infer<typeof studentSportDataSchema>;
export type PersonalRecord = StudentSportData["records"][number];
export type SportActionResult = { ok: true; message: string } | { ok: false; message: string };

export function calculateBmi(weightKg: number, heightM: number) {
  return Number((weightKg / (heightM * heightM)).toFixed(2));
}

export function parseWodTime(value: string) {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((part) => /^\d{1,2}$/.test(part))) return null;
  const numbers = parts.map(Number);
  const [hours, minutes, seconds] = parts.length === 3 ? numbers : [0, numbers[0], numbers[1]];
  if (minutes > 59 || seconds > 59 || (parts.length === 2 && minutes > 99)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 && total <= 24 * 3600 ? total : null;
}

export function formatWodTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${mmss}` : mmss;
}

export function bestComparableRecord(records: PersonalRecord[], target: PersonalRecord) {
  const comparable = records.filter((record) => record.ejercicio === target.ejercicio
    && record.nombre_personalizado === target.nombre_personalizado && record.unidad === target.unidad);
  if (!comparable.length) return null;
  return comparable.reduce((best, record) => target.unidad === "TIEMPO"
    ? (record.valor < best.valor ? record : best)
    : (record.valor > best.valor ? record : best));
}

export const exerciseLabels: Record<SportExercise, string> = {
  BACK_SQUAT: "Back Squat", FRONT_SQUAT: "Front Squat", DEADLIFT: "Deadlift",
  BENCH_PRESS: "Bench Press", CLEAN: "Clean", CLEAN_AND_JERK: "Clean & Jerk",
  SNATCH: "Snatch", PULL_UPS: "Pull-ups", OTRO: "Otro",
};
