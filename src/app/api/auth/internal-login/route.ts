import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { internalEmail, usernameSchema } from "@/lib/usuarios-internos/model";

const requestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(72),
});

const invalidResponse = () => NextResponse.json(
  { ok: false, message: "Correo, usuario o contraseña incorrectos." },
  { status: 401 }
);

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return invalidResponse();

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalEmail(parsed.data.username),
      password: parsed.data.password,
    });
    if (error || !data.user || !data.session) return invalidResponse();

    const { data: profile, error: profileError } = await supabase
      .from("usuarios")
      .select("login_username,rol,activo")
      .eq("id", data.user.id)
      .single();

    const valid = !profileError
      && profile?.activo === true
      && profile.login_username === parsed.data.username
      && (profile.rol === "owner" || profile.rol === "staff");

    if (!valid) {
      await supabase.auth.signOut();
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
