import { z } from "zod";

export const PRIVACY_NOTICE_VERSION = "2026-10-04-v1";
export const PRIVACY_NOTICE_DATE = "2026-10-04";

export const privacyRequestTypes = [
  "ACCESO", "RECTIFICACION", "ACTUALIZACION", "ELIMINACION",
  "OPOSICION", "PORTABILIDAD", "SUSPENSION", "OTRA",
] as const;
export const privacyRequestStates = ["RECIBIDA", "EN_REVISION", "ATENDIDA", "RECHAZADA"] as const;
export type PrivacyRequestType = (typeof privacyRequestTypes)[number];
export type PrivacyRequestState = (typeof privacyRequestStates)[number];

export const privacyRequestTypeLabels: Record<PrivacyRequestType, string> = {
  ACCESO: "Acceso",
  RECTIFICACION: "Rectificación",
  ACTUALIZACION: "Actualización",
  ELIMINACION: "Eliminación cuando proceda",
  OPOSICION: "Oposición",
  PORTABILIDAD: "Portabilidad",
  SUSPENSION: "Suspensión del tratamiento",
  OTRA: "Otra solicitud",
};

export const privacyRequestStateLabels: Record<PrivacyRequestState, string> = {
  RECIBIDA: "Recibida",
  EN_REVISION: "En revisión",
  ATENDIDA: "Atendida",
  RECHAZADA: "Rechazada",
};

export const acceptPrivacySchema = z.object({
  aviso_version: z.literal(PRIVACY_NOTICE_VERSION),
  aviso_leido: z.literal(true, { error: "Confirma que leíste el aviso vigente." }),
  comunicaciones_promocionales: z.boolean(),
}).strict();

export const createPrivacyRequestSchema = z.object({
  tipo: z.enum(privacyRequestTypes),
  descripcion: z.string().trim()
    .min(10, "Describe tu solicitud con al menos 10 caracteres.")
    .max(2000, "La descripción no puede superar 2000 caracteres."),
}).strict();

export const reviewPrivacyRequestSchema = z.object({
  solicitud_id: z.string().uuid(),
  estado: z.enum(["EN_REVISION", "ATENDIDA", "RECHAZADA"]),
  respuesta: z.string().trim().max(2000, "La respuesta no puede superar 2000 caracteres."),
}).strict().superRefine((value, context) => {
  if (["ATENDIDA", "RECHAZADA"].includes(value.estado) && value.respuesta.length < 3) {
    context.addIssue({ code: "custom", path: ["respuesta"], message: "Escribe una respuesta para cerrar la solicitud." });
  }
});

export type PrivacyAcceptance = {
  id: string;
  aviso_version: string;
  accepted_at: string;
  contexto: string;
  finalidades_aceptadas: string[];
  comunicaciones_promocionales: boolean;
};

export type StudentPrivacyRequest = {
  id: string;
  tipo: PrivacyRequestType;
  descripcion: string;
  estado: PrivacyRequestState;
  created_at: string;
  reviewed_at: string | null;
  respuesta: string | null;
};

export type StudentPrivacyData = {
  available: boolean;
  acceptance: PrivacyAcceptance | null;
  requests: StudentPrivacyRequest[];
  error: string | null;
};

export type ManagementPrivacyRequest = StudentPrivacyRequest & {
  usuario_id: string;
  solicitante_nombre: string;
  solicitante_email: string;
  updated_at: string;
  reviewed_by: string | null;
  revisor_nombre: string | null;
};

export type PrivacyActionResult = { ok: true; message: string } | { ok: false; message: string };

export const managementPrivacyRequestsSchema = z.array(z.object({
  id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  solicitante_nombre: z.string(),
  solicitante_email: z.string(),
  tipo: z.enum(privacyRequestTypes),
  descripcion: z.string(),
  estado: z.enum(privacyRequestStates),
  created_at: z.string(),
  updated_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  revisor_nombre: z.string().nullable(),
  respuesta: z.string().nullable(),
}));
