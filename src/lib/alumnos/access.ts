import "server-only";
import { createClient } from "@/lib/supabase/server";
import { studentPortalSchema } from "./model";

export async function getStudentAccess() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await supabase.from("usuarios")
    .select("nombre, rol, activo").eq("id", user.id).single();
  if (profileError || !profile?.activo || profile.rol !== "alumno") return null;
  return { supabase, userId: user.id, name: profile.nombre };
}

export async function loadStudentPortal() {
  const access = await getStudentAccess();
  if (!access) return { access: null, data: null, error: "Tu sesión no corresponde a un alumno activo." };
  const result = await access.supabase.rpc("obtener_portal_alumno");
  if (result.error) {
    const pending = result.error.code === "PGRST202" || result.error.code === "42883";
    return { access, data: null, error: pending
      ? "El Portal del Alumno requiere aplicar primero su migración."
      : "No fue posible cargar tu información. Inténtalo de nuevo." };
  }
  const parsed = studentPortalSchema.safeParse(result.data);
  return parsed.success
    ? { access, data: parsed.data, error: null }
    : { access, data: null, error: "La información del portal no tiene el formato esperado." };
}
