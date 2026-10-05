"use server";

import { revalidatePath } from "next/cache";
import { getStudentAccess } from "@/lib/alumnos/access";
import {
  hasExpectedPaymentReceiptSignature,
  reportPaymentSchema,
  validatePaymentReceiptMetadata,
  type ActionResult,
} from "@/lib/alumnos/model";

export async function reportStudentPayment(input: FormData): Promise<ActionResult> {
  try {
    const parsed = reportPaymentSchema.safeParse({
      monto: Number(input.get("monto")),
      fecha_pago: input.get("fecha_pago"),
      observacion: input.get("observacion") ?? "",
      membresia_id: input.get("membresia_id") || null,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };
    }
    const access = await getStudentAccess();
    if (!access) return { ok: false, message: "No tienes permiso para reportar pagos." };
    const receipt = input.get("comprobante");
    if (!receipt || typeof receipt === "string") {
      return { ok: false, message: "Adjunta el comprobante del pago." };
    }
    const receiptMetadata = validatePaymentReceiptMetadata(receipt);
    if (!receiptMetadata.ok) return { ok: false, message: receiptMetadata.message };
    const receiptBytes = new Uint8Array(await receipt.arrayBuffer());
    if (!hasExpectedPaymentReceiptSignature(receiptBytes, receiptMetadata.mime)) {
      return { ok: false, message: "El contenido del archivo no corresponde a un JPG, PNG o PDF válido." };
    }
    const value = parsed.data;
    const receiptPath = `${access.userId}/${crypto.randomUUID()}.${receiptMetadata.storedExtension}`;
    const upload = await access.supabase.storage.from("payment-receipts").upload(receiptPath, receiptBytes, {
      contentType: receiptMetadata.mime,
      upsert: false,
    });
    if (upload.error) {
      return { ok: false, message: "No fue posible guardar el comprobante. Revisa el archivo e inténtalo de nuevo." };
    }
    const { error } = await access.supabase.rpc("reportar_pago_alumno", {
      p_monto: value.monto,
      p_fecha_pago: value.fecha_pago,
      p_observacion: value.observacion || null,
      p_membresia_id: value.membresia_id,
      p_comprobante_path: receiptPath,
      p_comprobante_mime: receiptMetadata.mime,
      p_comprobante_size: receiptMetadata.size,
    });
    if (error) {
      await access.supabase.storage.from("payment-receipts").remove([receiptPath]);
      const pending = error.code === "PGRST202" || error.code === "42883";
      return { ok: false, message: pending
        ? "El formulario requiere aplicar primero la migración de comprobantes."
        : "No fue posible registrar el reporte. Revisa los datos e inténtalo de nuevo." };
    }
    revalidatePath("/portal");
    return { ok: true, message: "Pago reportado. Pendiente de verificación." };
  } catch {
    return { ok: false, message: "No fue posible registrar el reporte. Comprueba tu conexión." };
  }
}
