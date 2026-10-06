import { z } from "zod";
import { businessDate } from "@/lib/clientes/model";

export const reportStates = ["PENDIENTE", "APROBADO", "RECHAZADO"] as const;
export type ReportState = (typeof reportStates)[number];

export const paymentReceiptMaxBytes = 5 * 1024 * 1024;
export const paymentReceiptMimeTypes = ["image/jpeg", "image/png", "application/pdf"] as const;
export type PaymentReceiptMime = (typeof paymentReceiptMimeTypes)[number];
export const receiptCleanupStates = ["LEGACY", "PENDIENTE", "ERROR", "ELIMINADO"] as const;
export type ReceiptCleanupState = (typeof receiptCleanupStates)[number];

const receiptExtensions: Record<string, { mime: PaymentReceiptMime; storedExtension: "jpg" | "png" | "pdf" }> = {
  jpg: { mime: "image/jpeg", storedExtension: "jpg" },
  jpeg: { mime: "image/jpeg", storedExtension: "jpg" },
  png: { mime: "image/png", storedExtension: "png" },
  pdf: { mime: "application/pdf", storedExtension: "pdf" },
};

export function validatePaymentReceiptMetadata(file: { name: string; type: string; size: number }) {
  if (!file.name || file.name.length > 255 || /[\\/\0]/.test(file.name)) {
    return { ok: false as const, message: "El nombre del archivo no es válido." };
  }
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  const allowed = receiptExtensions[extension];
  if (!allowed) {
    return { ok: false as const, message: "Adjunta un archivo JPG, JPEG, PNG o PDF." };
  }
  const normalizedMime = file.type.toLocaleLowerCase("en-US");
  if (normalizedMime !== allowed.mime) {
    return { ok: false as const, message: "El tipo del archivo no coincide con su extensión." };
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false as const, message: "El comprobante está vacío o no se pudo leer." };
  }
  if (file.size > paymentReceiptMaxBytes) {
    return { ok: false as const, message: "El comprobante no puede superar 5 MB." };
  }
  return { ok: true as const, mime: allowed.mime, storedExtension: allowed.storedExtension, size: file.size };
}

export function hasExpectedPaymentReceiptSignature(bytes: Uint8Array, mime: PaymentReceiptMime) {
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return startsWith([0xff, 0xd8, 0xff]);
  if (mime === "image/png") return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]);
}

export const reportPaymentSchema = z.object({
  monto: z.number({ error: "Ingresa un monto válido." })
    .finite("Ingresa un monto válido.")
    .positive("El monto debe ser mayor que cero.")
    .max(99999999.99, "El monto es demasiado alto.")
    .refine((value) => Number(value.toFixed(2)) === value, "Usa máximo dos decimales."),
  fecha_pago: z.iso.date({ error: "Ingresa una fecha válida." })
    .refine((value) => value <= businessDate(), "La fecha de pago no puede ser futura."),
  observacion: z.string().trim().max(1000, "Máximo 1000 caracteres."),
  membresia_id: z.string().uuid().nullable(),
}).strict();

export const reviewPaymentSchema = z.object({
  reporte_id: z.string().uuid(),
  decision: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().trim().max(500, "El motivo no puede superar 500 caracteres."),
}).strict().superRefine((value, context) => {
  if (value.decision === "rechazar" && value.motivo.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["motivo"],
      message: "Indica un motivo de rechazo de al menos 3 caracteres.",
    });
  }
});

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
  banco_origen: nullableText,
  referencia: nullableText,
  comprobante_path: nullableText,
  comprobante_mime: nullableText,
  comprobante_size: z.coerce.number().int().positive().nullable(),
  comprobante_eliminado_at: nullableText,
  comprobante_limpieza_estado: z.enum(receiptCleanupStates),
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
  usuario_id: string;
  membresia_id: string | null;
  monto: number;
  fecha_pago: string;
  banco_origen: string | null;
  referencia: string | null;
  comprobante_path: string | null;
  comprobante_mime: string | null;
  comprobante_size: number | null;
  comprobante_eliminado_at: string | null;
  comprobante_original_mime: string | null;
  comprobante_original_size: number | null;
  comprobante_limpieza_estado: ReceiptCleanupState;
  comprobante_limpieza_intentos: number;
  comprobante_limpieza_error_at: string | null;
  observacion: string | null;
  estado: ReportState;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  motivo_rechazo: string | null;
  pago_real_id: string | null;
  alumno: string;
  membresia: string | null;
  membresia_fecha_inicio: string | null;
  membresia_fecha_fin: string | null;
  saldo_membresia: number | null;
  estado_pago_membresia: string | null;
  revisor: string | null;
  monto_aplicado: number | null;
};

const adminPaymentReportSchema = z.object({
  id: z.string().uuid(),
  cliente_id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  membresia_id: z.string().uuid().nullable(),
  monto: z.coerce.number(),
  fecha_pago: z.string(),
  banco_origen: nullableText,
  referencia: nullableText,
  comprobante_path: nullableText,
  comprobante_mime: nullableText,
  comprobante_size: z.coerce.number().int().positive().nullable(),
  comprobante_eliminado_at: nullableText,
  comprobante_original_mime: nullableText,
  comprobante_original_size: z.coerce.number().int().positive().nullable(),
  comprobante_limpieza_estado: z.enum(receiptCleanupStates),
  comprobante_limpieza_intentos: z.coerce.number().int().nonnegative(),
  comprobante_limpieza_error_at: nullableText,
  observacion: nullableText,
  estado: z.enum(reportStates),
  created_at: z.string(),
  reviewed_at: nullableText,
  reviewed_by: z.string().uuid().nullable(),
  motivo_rechazo: nullableText,
  pago_real_id: z.string().uuid().nullable(),
  alumno: z.string(),
  membresia: nullableText,
  membresia_fecha_inicio: nullableText,
  membresia_fecha_fin: nullableText,
  saldo_membresia: z.coerce.number().nullable(),
  estado_pago_membresia: nullableText,
  revisor: nullableText,
  monto_aplicado: z.coerce.number().nullable(),
});

export const adminPaymentReportsSchema = z.array(adminPaymentReportSchema);

export type ReportFilter = "TODOS" | ReportState;

export function filterAdminPaymentReports(
  reports: AdminPaymentReport[],
  state: ReportFilter,
  query: string,
) {
  const normalizedQuery = normalizeSearch(query);
  return reports.filter((report) => {
    if (state !== "TODOS" && report.estado !== state) return false;
    if (!normalizedQuery) return true;
    return normalizeSearch([
      report.alumno,
      report.membresia ?? "",
      report.banco_origen ?? "",
      report.referencia ?? "",
      report.observacion ?? "",
      report.fecha_pago,
      report.created_at,
    ].join(" ")).includes(normalizedQuery);
  });
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-EC").trim();
}

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
