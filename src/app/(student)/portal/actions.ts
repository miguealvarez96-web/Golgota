"use server";

import { revalidatePath } from "next/cache";
import { getStudentAccess } from "@/lib/alumnos/access";
import { reportPaymentSchema, type ActionResult } from "@/lib/alumnos/model";

export async function reportStudentPayment(input: unknown): Promise<ActionResult> {
  try {
    const parsed = reportPaymentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };
    }
    const access = await getStudentAccess();
    if (!access) return { ok: false, message: "No tienes permiso para reportar pagos." };
    const value = parsed.data;
    const { error } = await access.supabase.rpc("reportar_pago_alumno", {
      p_monto: value.monto,
      p_fecha_pago: value.fecha_pago,
      p_banco_origen: value.banco_origen,
      p_referencia: value.referencia,
      p_observacion: value.observacion || null,
      p_membresia_id: value.membresia_id,
    });
    if (error) {
      const pending = error.code === "PGRST202" || error.code === "42883";
      return { ok: false, message: pending
        ? "El formulario requiere aplicar primero la migración del Portal del Alumno."
        : "No fue posible registrar el reporte. Revisa los datos e inténtalo de nuevo." };
    }
    revalidatePath("/portal");
    return { ok: true, message: "Pago reportado. Pendiente de verificación." };
  } catch {
    return { ok: false, message: "No fue posible registrar el reporte. Comprueba tu conexión." };
  }
}
