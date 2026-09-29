import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canCreateClients, type ClientRole } from "./model";

// Toda consulta/acción del módulo valida de nuevo la identidad en el servidor.
export async function getClientAccess() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await supabase.from("usuarios")
    .select("rol, activo").eq("id", user.id).single();
  if (profileError || !profile?.activo || !canCreateClients(profile.rol)) return null;
  return { supabase, userId: user.id, role: profile.rol as ClientRole };
}
