import { z } from "zod";

export const clientStates = ["Activo", "Inactivo", "Suspendido", "Cancelado"] as const;
export type ClientState = (typeof clientStates)[number];
export type ClientRole = "admin" | "owner" | "staff";
export function canManageClients(role: string) { return role === "admin" || role === "owner"; }
export function canCreateClients(role: string) { return canManageClients(role) || role === "staff"; }

export function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const clientSchema = z.object({
  nombre_completo: z.string().trim().min(2, "Ingresa al menos 2 caracteres.").max(255, "Máximo 255 caracteres."),
  cedula: z.string().trim().regex(/^\d{1,20}$/, "Usa únicamente números, hasta 20 dígitos."),
  celular: z.string().trim().max(20, "Máximo 20 caracteres.")
    .refine((value) => !value || (/^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7), "Ingresa un teléfono válido.")
    .transform((value) => value || null),
  email: z.union([z.literal(""), z.string().trim().max(255).email("Ingresa un correo válido.")])
    .transform((value) => value.toLowerCase() || null),
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
export type MembershipSummary = { id: string; estado_vigencia: string; fecha_fin: string };
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
