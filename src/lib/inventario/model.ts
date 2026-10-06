import { z } from "zod";

export const inventoryStates = ["BUENO", "MANTENIMIENTO", "DANADO", "BAJA"] as const;
export const incidentTypes = ["DANIO", "MANTENIMIENTO", "BAJA"] as const;
export const incidentStates = ["PENDIENTE", "RESUELTO"] as const;
export type InventoryRole = "admin" | "owner" | "staff";

export function canViewInventory(role: string): role is InventoryRole {
  return role === "admin" || role === "owner" || role === "staff";
}
export function canManageInventory(role: string) { return role === "admin" || role === "owner"; }

function normalizedText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").trim();
}
const requiredText = (maximum: number, message: string) => z.string().transform(normalizedText)
  .pipe(z.string().min(1, "Este campo es obligatorio.").max(maximum, message));
const optionalText = (maximum: number, message: string) => z.string().max(maximum, message)
  .transform((value) => normalizedText(value) || null);
const quantity = z.string().trim().regex(/^[0-9]+$/, "La cantidad debe ser un entero igual o mayor que cero.")
  .transform(Number).refine((value) => Number.isSafeInteger(value) && value <= 2_147_483_647, "Cantidad fuera del rango permitido.");
const optionalCost = z.string().trim().refine((value) => value === "" || /^(?:0|0\.[0-9]{1,2}|[1-9][0-9]{0,7}(?:\.[0-9]{1,2})?)$/.test(value),
  "Ingresa un costo válido con máximo dos decimales.").transform((value) => value === "" ? null : Number(value));
const optionalDate = z.string().trim().refine((value) => value === "" || z.iso.date().safeParse(value).success, "Ingresa una fecha válida.")
  .transform((value) => value || null);

export const inventoryItemSchema = z.object({
  nombre: requiredText(255, "Máximo 255 caracteres."),
  categoria: requiredText(100, "Máximo 100 caracteres."),
  cantidad: quantity,
  estado: z.enum(inventoryStates, { error: "Selecciona un estado válido." }),
  fecha_compra: optionalDate,
  costo: optionalCost,
  ubicacion: optionalText(160, "Máximo 160 caracteres."),
  observacion: optionalText(2000, "Máximo 2000 caracteres."),
}).strict();

export const inventoryIncidentSchema = z.object({
  inventario_item_id: z.string().uuid(),
  tipo: z.enum(incidentTypes, { error: "Selecciona un tipo válido." }),
  observacion: requiredText(2000, "Máximo 2000 caracteres."),
}).strict();

export type InventoryItemInput = z.input<typeof inventoryItemSchema>;
export type InventoryIncidentInput = z.input<typeof inventoryIncidentSchema>;
export type InventoryOperationalRow = {
  id: string; nombre: string; categoria: string; cantidad: number; estado: (typeof inventoryStates)[number];
  ubicacion: string | null; observacion: string | null; updated_at: string;
};
export type InventoryManagementRow = InventoryOperationalRow & {
  fecha_compra: string | null; costo: number | null; created_by: string | null; updated_by: string | null; created_at: string;
};
export type InventoryRow = InventoryOperationalRow | InventoryManagementRow;
export type InventoryIncidentRow = {
  id: string; inventario_item_id: string; tipo: (typeof incidentTypes)[number]; observacion: string;
  reportado_por: string; fecha: string; estado: (typeof incidentStates)[number]; resuelto_por: string | null; resuelto_at: string | null;
};
export type InventoryResult = { ok: true; id: string; message: string } | {
  ok: false; message: string; errors?: Record<string, string[]>;
};

export function inventorySearchFilter(query: string) {
  const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return ["nombre", "categoria"].map((field) => `${field}.ilike.${pattern}`).join(",");
}

export function inventoryMoneyLabel(value: number | null) {
  return value === null ? "No registrado" : new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
}
