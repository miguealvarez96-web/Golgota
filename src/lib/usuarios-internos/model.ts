import { z } from "zod";

export const INTERNAL_EMAIL_DOMAIN = "golgota.internal";
export const internalRoles = ["owner", "staff"] as const;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "El usuario debe tener al menos 3 caracteres.")
  .max(50, "El usuario puede tener hasta 50 caracteres.")
  .regex(/^[a-z0-9._-]+$/, "Usa solo letras, números, punto, guion o guion bajo.");

const passwordSchema = z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(72, "La contraseña puede tener hasta 72 caracteres.");

export const createInternalUserSchema = z.object({
  nombre: z.string().trim().min(2, "Ingresa el nombre.").max(255, "El nombre es demasiado largo."),
  username: usernameSchema,
  rol: z.enum(internalRoles),
  password: passwordSchema,
  passwordConfirmation: z.string(),
  activo: z.boolean(),
}).refine((value) => value.password === value.passwordConfirmation, {
  message: "Las contraseñas no coinciden.",
  path: ["passwordConfirmation"],
});

export const resetInternalPasswordSchema = z.object({
  id: z.string().uuid(),
  password: passwordSchema,
  passwordConfirmation: z.string(),
}).refine((value) => value.password === value.passwordConfirmation, {
  message: "Las contraseñas no coinciden.",
  path: ["passwordConfirmation"],
});

export const updateInternalUserSchema = z.object({
  id: z.string().uuid(),
  rol: z.enum(internalRoles),
  activo: z.boolean(),
});

export type InternalRole = (typeof internalRoles)[number];

export type InternalUserRow = {
  id: string;
  nombre: string;
  login_username: string;
  rol: InternalRole;
  activo: boolean;
  created_at: string;
};

export type InternalUserResult = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[] | undefined>;
};

export function internalEmail(username: string) {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`;
}
