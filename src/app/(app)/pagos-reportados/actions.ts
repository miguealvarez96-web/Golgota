"use server";

import { revalidatePath } from "next/cache";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";
import { reviewPaymentSchema, type ActionResult } from "@/lib/alumnos/model";

export async function reviewReportedPayment(input: unknown): Promise<ActionResult> {
  try {
    const parsed = reviewPaymentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la solicitud." };
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) {
      return { ok: false, message: "No tienes permiso para revisar pagos reportados." };
    }
    const rpc = parsed.data.decision === "aprobar"
      ? access.supabase.rpc("aprobar_reporte_pago_alumno", { p_reporte_id: parsed.data.reporte_id })
      : access.supabase.rpc("rechazar_reporte_pago_alumno", {
        p_reporte_id: parsed.data.reporte_id,
        p_motivo: parsed.data.motivo || null,
      });
    const { error } = await rpc;
    if (error) {
      const alreadyReviewed = error.code === "55000";
      return { ok: false, message: alreadyReviewed
        ? "Este reporte ya fue revisado."
        : parsed.data.decision === "aprobar"
          ? "No fue posible aprobar. Revisa que la membresía tenga saldo suficiente y siga disponible."
          : "No fue posible rechazar el reporte." };
    }
    revalidatePath("/pagos-reportados");
    revalidatePath("/membresias");
    revalidatePath("/");
    return { ok: true, message: parsed.data.decision === "aprobar"
      ? "Pago aprobado y aplicado correctamente."
      : "Reporte rechazado sin modificar valores financieros." };
  } catch {
    return { ok: false, message: "No fue posible completar la revisión." };
  }
}
