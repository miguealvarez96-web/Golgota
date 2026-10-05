import { z } from "zod";

import {
  clientEmailSchema,
  clientIdentificationSchema,
  clientNameSchema,
  clientPhoneSchema,
} from "@/lib/clientes/model";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacidad/model";

export const studentRegistrationSchema = z.object({
  nombres: clientNameSchema,
  apellidos: clientNameSchema,
  cedula: clientIdentificationSchema,
  celular: clientPhoneSchema,
  email: clientEmailSchema,
  password: z.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(72, "La contraseña no puede superar 72 caracteres.")
    .regex(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/, "Incluye al menos una letra.")
    .regex(/[0-9]/, "Incluye al menos un número."),
  confirmPassword: z.string(),
  aviso_version: z.literal(PRIVACY_NOTICE_VERSION),
  aviso_leido: z.literal(true, { error: "Debes aceptar el aviso de privacidad." }),
  comunicaciones_promocionales: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.password !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Las contraseñas no coinciden." });
  }
});

export type StudentRegistrationInput = z.input<typeof studentRegistrationSchema>;
export type StudentRegistrationResult =
  | { ok: true; code: "READY"; message: string; token: string; email: string }
  | { ok: false; code: "INVALID" | "ALREADY_LINKED" | "HELP_REQUIRED" | "EMAIL_EXISTS" | "RATE_LIMITED" | "ERROR"; message: string; errors?: Record<string, string[]> };
