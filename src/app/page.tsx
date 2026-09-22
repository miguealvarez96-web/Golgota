import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: perfil, error } = await supabase
    .from("usuarios")
    .select("nombre, rol, activo")
    .eq("id", user.id)
    .single();

  if (error || !perfil) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <p>No fue posible cargar el perfil del usuario.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-white">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold">
          Gólgota CF
        </h1>

        <p className="mt-2 text-zinc-400">
          Portal de administración
        </p>

        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p>
            <strong>Usuario:</strong> {perfil.nombre}
          </p>

          <p className="mt-2">
            <strong>Correo:</strong> {user.email}
          </p>

          <p className="mt-2">
            <strong>Rol:</strong> {perfil.rol}
          </p>

          <p className="mt-2">
            <strong>Estado:</strong>{" "}
            {perfil.activo ? "Activo" : "Inactivo"}
          </p>
        </div>
      </div>
    </main>
  );
}
