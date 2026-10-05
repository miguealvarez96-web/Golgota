"use server";

import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { studentRegistrationSchema, type StudentRegistrationResult } from "@/lib/registro/model";
import { createClient as createSessionClient } from "@/lib/supabase/server";

const messages = {
  ALREADY_LINKED: "Ya existe una cuenta asociada a este alumno. Inicia sesión o recupera tu contraseña.",
  HELP_REQUIRED: "Ya existe un registro con estos datos. Solicita ayuda a Gólgota para activar tu acceso.",
  EMAIL_EXISTS: "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.",
  RATE_LIMITED: "Se realizaron varios intentos. Espera unos minutos antes de volver a intentarlo.",
} as const;

export async function prepareStudentRegistration(input: unknown): Promise<StudentRegistrationResult> {
  const parsed = studentRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const { data: { user } } = await createSessionClient().auth.getUser();
    if (user) {
      return { ok: false, code: "ERROR", message: "Cierra tu sesión actual antes de crear otra cuenta." };
    }
    const token = randomUUID();
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
    const { data, error } = await supabase.rpc("preparar_registro_alumno", {
      p_token: token,
      p_nombres: parsed.data.nombres,
      p_apellidos: parsed.data.apellidos,
      p_cedula: parsed.data.cedula,
      p_celular: parsed.data.celular,
      p_email: parsed.data.email,
      p_aviso_version: parsed.data.aviso_version,
      p_comunicaciones_promocionales: parsed.data.comunicaciones_promocionales,
    });
    if (error || !data || typeof data !== "object") {
      return { ok: false, code: "ERROR", message: "No fue posible preparar el registro. Inténtalo de nuevo." };
    }
    const code = String((data as { code?: unknown }).code ?? "ERROR") as keyof typeof messages | "READY";
    if (code !== "READY") {
      return { ok: false, code: code in messages ? code : "ERROR", message: messages[code as keyof typeof messages] ?? "No fue posible preparar el registro. Inténtalo de nuevo." };
    }
    return { ok: true, code: "READY", message: "Registro preparado.", token, email: parsed.data.email };
  } catch {
    return { ok: false, code: "ERROR", message: "No fue posible preparar el registro. Comprueba tu conexión e inténtalo de nuevo." };
  }
}
