import { z } from "zod";

export const clientStates = ["Activo", "Inactivo", "Suspendido", "Cancelado"] as const;
export type ClientState = (typeof clientStates)[number];
export type ClientRole = "admin" | "owner" | "staff";
export function canManageClients(role: string) { return role === "admin" || role === "owner"; }
export function canCreateClients(role: string) { return canManageClients(role) || role === "staff"; }

export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const namePattern = /^[A-ZÁÉÍÓÚÜÑ]+(?:[ '’-][A-ZÁÉÍÓÚÜÑ]+)*$/;
export function normalizeClientName(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").trim().toLocaleUpperCase("es-EC");
}
export function normalizeClientPhone(value: string) {
  const raw = value.replace(/\u00a0/g, " ").trim();
  return raw ? raw.replace(/[ \t\r\n\f\v()-]/g, "") : null;
}

export const clientNameSchema = z.string().transform(normalizeClientName).pipe(z.string()
  .min(2, "Ingresa al menos 2 caracteres.").max(255, "Máximo 255 caracteres.")
  .regex(namePattern, "Usa letras, espacios, guion o apóstrofe; sin números ni símbolos."));
export const clientIdentificationSchema = z.string().trim()
  .regex(/^[0-9]{1,20}$/, "Para cédula, usa solo dígitos (máximo 20).");
export const clientPhoneSchema = z.string().max(64, "El teléfono ingresado es demasiado largo.")
  .transform(normalizeClientPhone)
  .refine((value) => value !== null && /^\+?[0-9]{7,20}$/.test(value) && value.length <= 20,
    "Usa 7 a 20 dígitos y, si corresponde, un + inicial.");
export const clientEmailSchema = z.string().trim().max(255, "Máximo 255 caracteres.")
  .transform((value) => value.toLowerCase())
  .pipe(z.email("Ingresa un correo válido."));

export const clientSchema = z.object({
  nombre_completo: clientNameSchema,
  cedula: clientIdentificationSchema,
  celular: z.string().max(64, "El teléfono ingresado es demasiado largo.")
    .transform(normalizeClientPhone)
    .refine((value) => value === null || (/^\+?[0-9]{7,20}$/.test(value) && value.length <= 20),
      "Usa 7 a 20 dígitos y, si corresponde, un + inicial."),
  email: z.string().trim().max(255, "Máximo 255 caracteres.")
    .transform((value) => value.toLowerCase() || null)
    .refine((value) => value === null || z.email().safeParse(value).success, "Ingresa un correo válido."),
  estado_cliente: z.enum(clientStates, { error: "Selecciona un estado válido." }),
  fecha_registro: z.iso.date({ error: "Ingresa una fecha válida." })
    .refine((value) => value <= businessDate(), "La fecha de registro no puede ser futura."),
}).strict();

export type ClientInput = z.input<typeof clientSchema>;
export type ClientRow = {
  id: string; nombre_completo: string; cedula: string;
  celular: string | null; email: string | null;
  estado_cliente: ClientState | null; fecha_registro: string;
};
export type MembershipSummary = {
  id: string;
  plan: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado_vigencia: string;
};
export type SaveClientResult = { ok: true; message: string } | {
  ok: false; message: string; errors?: Partial<Record<keyof ClientInput, string[]>>;
};

// PostgREST: entrecomillar el valor completo evita que comas/paréntesis alteren
// el filtro OR. Escapar comodines para buscar literalmente lo que se escribió.
export function clientSearchFilter(query: string) {
  const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return ["nombre_completo", "cedula", "celular", "email"].map((field) => `${field}.ilike.${pattern}`).join(",");
}

export function displayDate(value: string) {
  return new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
