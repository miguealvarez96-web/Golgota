import { createClient } from "@/lib/supabase/server";

export async function getInternalUsersAdminAccess() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("usuarios")
    .select("rol,activo")
    .eq("id", user.id)
    .single();

  if (error || !profile?.activo || profile.rol !== "admin") return null;
  return { supabase, userId: user.id };
}
