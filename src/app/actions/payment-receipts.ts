"use server";

import { createClient } from "@/lib/supabase/server";

type ReceiptUrlResult =
  | { ok: true; url: string; mime: string }
  | { ok: false; message: string };

export async function getPaymentReceiptUrl(reportId: string): Promise<ReceiptUrlResult> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
      return { ok: false, message: "El reporte no es válido." };
    }
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { ok: false, message: "Tu sesión ya no está disponible." };
    const { data: profile, error: profileError } = await supabase.from("usuarios")
      .select("rol, activo").eq("id", user.id).single();
    if (profileError || !profile?.activo || !["alumno", "admin", "owner"].includes(profile.rol)) {
      return { ok: false, message: "No tienes permiso para ver este comprobante." };
    }
    const { data: report, error: reportError } = await supabase.from("reportes_pago_alumno")
      .select("comprobante_path, comprobante_mime").eq("id", reportId).single();
    if (reportError || !report?.comprobante_path || !report.comprobante_mime) {
      return { ok: false, message: "Este reporte no tiene un comprobante disponible." };
    }
    const { data, error } = await supabase.storage.from("payment-receipts")
      .createSignedUrl(report.comprobante_path, 120);
    if (error || !data?.signedUrl) {
      return { ok: false, message: "No fue posible abrir el comprobante." };
    }
    return { ok: true, url: data.signedUrl, mime: report.comprobante_mime };
  } catch {
    return { ok: false, message: "No fue posible abrir el comprobante." };
  }
}
