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
    let cleanupOk = false;
    try {
      cleanupOk = await cleanupResolvedPaymentReceipt(access, parsed.data.reporte_id);
    } catch {
      // La revisión ya terminó en PostgreSQL. Un fallo de Storage nunca debe
      // convertir el pago aplicado o el rechazo registrado en un error aparente.
      cleanupOk = false;
    }
    revalidatePath("/pagos-reportados");
    revalidatePath("/membresias");
    revalidatePath("/portal");
    revalidatePath("/");
    const reviewedMessage = parsed.data.decision === "aprobar"
      ? "Pago aprobado y aplicado correctamente."
      : "Reporte rechazado sin modificar valores financieros.";
    return { ok: true, message: cleanupOk
      ? `${reviewedMessage} El comprobante fue eliminado.`
      : `${reviewedMessage} La limpieza del comprobante quedó pendiente de reintento.` };
  } catch {
    return { ok: false, message: "No fue posible completar la revisión." };
  }
}

export async function retryPaymentReceiptCleanup(reportId: string): Promise<ActionResult> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
      return { ok: false, message: "El reporte no es válido." };
    }
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) {
      return { ok: false, message: "No tienes permiso para limpiar comprobantes." };
    }
    const cleaned = await cleanupResolvedPaymentReceipt(access, reportId);
    revalidatePath("/pagos-reportados");
    revalidatePath("/portal");
    return cleaned
      ? { ok: true, message: "El comprobante fue eliminado correctamente." }
      : { ok: false, message: "No fue posible eliminarlo ahora. El reintento sigue disponible." };
  } catch {
    return { ok: false, message: "No fue posible completar la limpieza del comprobante." };
  }
}

async function cleanupResolvedPaymentReceipt(
  access: NonNullable<Awaited<ReturnType<typeof getClientAccess>>>,
  reportId: string,
) {
  const prepared = await access.supabase.rpc("obtener_comprobante_pago_limpieza", {
    p_reporte_id: reportId,
  });
  if (prepared.error) return false;
  const receipt = prepared.data as {
    path?: string | null;
    eliminado_at?: string | null;
  } | null;
  if (!receipt?.path) return Boolean(receipt?.eliminado_at);

  try {
    const removal = await access.supabase.storage.from("payment-receipts").remove([receipt.path]);
    if (removal.error) {
      await access.supabase.rpc("registrar_fallo_limpieza_comprobante", {
        p_reporte_id: reportId,
        p_comprobante_path: receipt.path,
      });
      return false;
    }
  } catch {
    await access.supabase.rpc("registrar_fallo_limpieza_comprobante", {
      p_reporte_id: reportId,
      p_comprobante_path: receipt.path,
    });
    return false;
  }

  const confirmation = await access.supabase.rpc("confirmar_limpieza_comprobante", {
    p_reporte_id: reportId,
    p_comprobante_path: receipt.path,
  });
  if (confirmation.error) {
    await access.supabase.rpc("registrar_fallo_limpieza_comprobante", {
      p_reporte_id: reportId,
      p_comprobante_path: receipt.path,
    });
    return false;
  }
  return true;
}
