import { z } from "zod";
import { businessDate } from "@/lib/clientes/model";

export const reportStates = ["PENDIENTE", "APROBADO", "RECHAZADO"] as const;
export type ReportState = (typeof reportStates)[number];

export const reportPaymentSchema = z.object({
  monto: z.number({ error: "Ingresa un monto válido." })
    .finite("Ingresa un monto válido.")
    .positive("El monto debe ser mayor que cero.")
    .max(99999999.99, "El monto es demasiado alto.")
    .refine((value) => Number(value.toFixed(2)) === value, "Usa máximo dos decimales."),
  fecha_pago: z.iso.date({ error: "Ingresa una fecha válida." })
    .refine((value) => value <= businessDate(), "La fecha de pago no puede ser futura."),
  banco_origen: z.string().trim().min(2, "Indica el banco u origen.").max(120, "Máximo 120 caracteres."),
  referencia: z.string().trim().min(2, "Indica la referencia o comprobante.").max(120, "Máximo 120 caracteres."),
  observacion: z.string().trim().max(1000, "Máximo 1000 caracteres."),
  membresia_id: z.string().uuid().nullable(),
}).strict();

export const reviewPaymentSchema = z.object({
  reporte_id: z.string().uuid(),
  decision: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().trim().max(500, "El motivo no puede superar 500 caracteres."),
}).strict();

const nullableText = z.string().nullable();
const membershipSchema = z.object({
  id: z.string().uuid(),
  plan: z.string(),
  fecha_inicio: z.string(),
  fecha_fin: z.string(),
  saldo: z.coerce.number(),
  estado_pago: z.string(),
  estado_vigencia: z.enum(["POR_INICIAR", "VIGENTE", "POR_VENCER", "VENCE_HOY", "VENCIDA"]),
  dias_restantes: z.coerce.number(),
});
const reportSchema = z.object({
  id: z.string().uuid(),
  membresia_id: z.string().uuid().nullable(),
  monto: z.coerce.number(),
  fecha_pago: z.string(),
  banco_origen: z.string(),
  referencia: z.string(),
  observacion: nullableText,
  estado: z.enum(reportStates),
  created_at: z.string(),
  reviewed_at: nullableText,
  motivo_rechazo: nullableText,
});

export const studentPortalSchema = z.object({
  cliente: z.object({
    id: z.string().uuid(),
    nombre_completo: z.string(),
    cedula: z.string(),
    celular: nullableText,
    email: nullableText,
  }),
  membresias: z.array(membershipSchema),
  reportes: z.array(reportSchema),
});

export type ReportPaymentInput = z.infer<typeof reportPaymentSchema>;
export type StudentPortal = z.infer<typeof studentPortalSchema>;
export type StudentMembership = StudentPortal["membresias"][number];
export type StudentPaymentReport = StudentPortal["reportes"][number];
export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export type AdminPaymentReport = {
  id: string;
  cliente_id: string;
  membresia_id: string | null;
  monto: number;
  fecha_pago: string;
  banco_origen: string;
  referencia: string;
  observacion: string | null;
  estado: ReportState;
  created_at: string;
  reviewed_at: string | null;
  motivo_rechazo: string | null;
  pago_real_id: string | null;
  alumno: string;
};

export function chooseStudentMembership(rows: StudentMembership[]) {
  const available = rows.filter((row) => row.estado_pago !== "CANCELADA");
  const current = available
    .filter((row) => ["VIGENTE", "POR_VENCER", "VENCE_HOY"].includes(row.estado_vigencia))
    .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin))[0];
  if (current) return current;
  const future = available.filter((row) => row.estado_vigencia === "POR_INICIAR")
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))[0];
  if (future) return future;
  return available.filter((row) => row.estado_vigencia === "VENCIDA")
    .sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin))[0] ?? null;
}

export function moneyLabel(value: number) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
}
