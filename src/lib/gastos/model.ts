import { z } from "zod";

export const expenseCategories = [
  "Arriendo", "Servicios basicos", "Nomina", "Mantenimiento", "Equipamiento",
  "Limpieza", "Marketing", "Software", "Compras", "Otros",
] as const;
export const expensePaymentMethods = ["Efectivo", "Transferencia", "Tarjeta", "Cheque", "Otro"] as const;
export const expenseStates = ["ACTIVO", "ANULADO"] as const;
export type ExpenseRole = "admin" | "owner";

export function canManageExpenses(role: string): role is ExpenseRole {
  return role === "admin" || role === "owner";
}

function normalizedText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").trim();
}

const optionalText = (maximum: number, message: string) => z.string().max(maximum, message)
  .transform((value) => normalizedText(value) || null);

const amount = z.string().trim()
  .regex(/^(?:0\.(?:0[1-9]|[1-9][0-9]?)|[1-9][0-9]{0,7}(?:\.[0-9]{1,2})?)$/,
    "Ingresa un monto mayor que cero, con máximo dos decimales.")
  .transform(Number);

export const expenseSchema = z.object({
  fecha: z.iso.date({ error: "Ingresa una fecha válida." }),
  categoria: z.enum(expenseCategories, { error: "Selecciona una categoría válida." }),
  descripcion: z.string().transform(normalizedText).pipe(z.string()
    .min(1, "La descripción es obligatoria.").max(500, "Máximo 500 caracteres.")),
  monto: amount,
  metodo_pago: z.union([z.enum(expensePaymentMethods), z.literal("")]).transform((value) => value || null),
  proveedor: optionalText(160, "Máximo 160 caracteres."),
  observacion: optionalText(2000, "Máximo 2000 caracteres."),
}).strict();

export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseRow = {
  id: string;
  fecha_gasto: string;
  tipo_gasto: string;
  descripcion: string;
  monto: number;
  metodo_pago: string | null;
  proveedor: string | null;
  observacion: string | null;
  estado: "ACTIVO" | "ANULADO";
  created_by: string | null;
  updated_by: string | null;
  anulado_por: string | null;
  anulado_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseResult = { ok: true; id: string; message: string } | {
  ok: false;
  message: string;
  errors?: Partial<Record<keyof ExpenseInput, string[]>>;
};

export function expenseSearchFilter(query: string) {
  const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return ["descripcion", "tipo_gasto", "proveedor", "observacion"]
    .map((field) => `${field}.ilike.${pattern}`).join(",");
}

export function moneyLabel(value: number) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
}
