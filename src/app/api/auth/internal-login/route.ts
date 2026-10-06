import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { usernameSchema } from "@/lib/usuarios-internos/model";

const requestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(72),
});

const invalidResponse = () => NextResponse.json(
  { ok: false, message: "Correo, usuario o contraseña incorrectos." },
  { status: 401 }
);

async function resolveInternalAuthUser(username: string) {
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("usuarios")
    .select("id,login_username,rol,activo")
    .eq("login_username", username)
    .maybeSingle();

  if (
    profileError
    || !profile
    || profile.login_username !== username
    || profile.activo !== true
    || (profile.rol !== "owner" && profile.rol !== "staff")
  ) {
    return null;
  }

  const { data, error } = await admin.auth.admin.getUserById(profile.id);
  const authUser = data.user;
  if (
    error
    || !authUser?.email
    || authUser.user_metadata?.account_type !== "internal"
  ) {
    return null;
  }

  return { id: profile.id, email: authUser.email };
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return invalidResponse();

    const internalUser = await resolveInternalAuthUser(parsed.data.username);
    if (!internalUser) return invalidResponse();

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalUser.email,
      password: parsed.data.password,
    });
    if (error || !data.user || !data.session || data.user.id !== internalUser.id) {
      if (data.session) await supabase.auth.signOut();
      return invalidResponse();
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, message: "No fue posible iniciar sesión. Comprueba tu conexión e inténtalo de nuevo." },
      { status: 500 }
    );
  }
}
