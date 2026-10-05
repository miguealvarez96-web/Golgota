import { z } from "zod";

export type CoachRole = "admin" | "owner" | "staff";

export function canUseCoachPortal(role: string): role is CoachRole {
  return role === "admin" || role === "owner" || role === "staff";
}

export function canManageCoachContent(role: string) {
  return role === "admin" || role === "owner";
}

function normalizedText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
}

const title = z.string().transform(normalizedText).pipe(z.string()
  .min(1, "El título es obligatorio.")
  .max(160, "Máximo 160 caracteres."));

const content = z.string().transform(normalizedText).pipe(z.string()
  .min(1, "El contenido es obligatorio.")
  .max(10000, "Máximo 10000 caracteres."));

export const wodSchema = z.object({
  fecha: z.iso.date({ error: "Ingresa una fecha válida." }),
  titulo: title,
  contenido: content,
  publicado: z.boolean(),
}).strict();

export const announcementSchema = z.object({
  titulo: title,
  contenido: content,
  publicado: z.boolean(),
}).strict();

export type WodInput = z.input<typeof wodSchema>;
export type AnnouncementInput = z.input<typeof announcementSchema>;

export type WodRow = {
  id: string;
  fecha: string;
  titulo: string;
  contenido: string;
  publicado: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AnnouncementRow = {
  id: string;
  titulo: string;
  contenido: string;
  publicado: boolean;
  fecha_publicacion: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CoachContentResult = { ok: true; id: string; message: string } | {
  ok: false;
  message: string;
  errors?: Record<string, string[]>;
};

