import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, type ProductRole } from "./model";

export async function getProductAccess() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase.from("usuarios")
    .select("rol, activo").eq("id", user.id).single();
  if (profileError || !profile?.activo || !canViewProducts(profile.rol)) return null;

  return { supabase, userId: user.id, role: profile.rol as ProductRole };
}
