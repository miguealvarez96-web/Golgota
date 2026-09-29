import { z } from "zod";
import { businessDate, displayDate } from "@/lib/clientes/model";

export const paymentMethods = ["Efectivo", "Transferencia", "Tarjeta", "Cheque", "Otro"] as const;
export const vigencyStates = ["VIGENTE", "POR_VENCER", "VENCE_HOY", "VENCIDA"] as const;
export const paymentStates = ["PENDIENTE", "PAGADO", "CANCELADA"] as const;
export { businessDate, displayDate };

const money = z.string().trim().regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Ingresa un monto válido con máximo dos decimales.")
  .transform((value) => Number(value));
export const createMembershipSchema = z.object({
  cliente_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  fecha_inicio: z.iso.date(),
  abono_inicial: money,
  metodo_pago: z.union([z.enum(paymentMethods), z.literal("")]),
  fecha_pago: z.iso.date(),
}).strict().refine((value) => value.abono_inicial === 0 || value.metodo_pago !== "", {
  message: "Selecciona un método para el abono inicial.", path: ["metodo_pago"],
});
export const registerPaymentSchema = z.object({
  membresia_id: z.string().uuid(),
  monto: money.refine((value) => value > 0, "El pago debe ser mayor que cero."),
  metodo_pago: z.enum(paymentMethods),
  fecha_pago: z.iso.date(),
}).strict();

export type MutationResult = { ok: true; id: string; message: string } | { ok: false; message: string };
export type MembershipRow = {
  id: string; cliente_id: string; plan_id: string; fecha_inicio: string; fecha_fin: string;
  valor: number; total_abonado: number; saldo: number; estado_pago: string;
  estado_vigencia: string | null; created_at: string;
  cliente: string; plan: string;
};
export type StaffMembershipRow = { cliente_id: string; cliente: string; plan: string; fecha_fin: string; estado_vigencia: string | null };
export type PaymentRow = { id: string; monto: number; fecha_pago: string; metodo_pago: string };

export function moneyLabel(value: number) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
}
export function ecuadorPaymentTimestamp(day: string) {
  // DATE del formulario se registra al mediodía de Ecuador, sin depender de la
  // zona horaria del navegador ni alterar el día calendario elegido.
  return `${day}T12:00:00-05:00`;
}
export function suggestedRenewalStart(previous: { fecha_fin: string; estado_pago: string } | null, today = businessDate()) {
  if (!previous || previous.estado_pago === "CANCELADA" || previous.fecha_fin < today) return today;
  return addCalendarDays(previous.fecha_fin, 1);
}
export function addCalendarDays(day: string, days: number) {
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
export function overlapsMembership(
  previous: { fecha_inicio: string; fecha_fin: string; estado_pago: string } | null,
  newStart: string, durationDays: number,
) {
  if (!previous || previous.estado_pago === "CANCELADA") return false;
  const newEnd = addCalendarDays(newStart, durationDays - 1);
  return previous.fecha_inicio <= newEnd && newStart <= previous.fecha_fin;
}
export function membershipSearchFilter(query: string) {
  const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return `nombre_completo.ilike.${pattern},cedula.ilike.${pattern}`;
}
