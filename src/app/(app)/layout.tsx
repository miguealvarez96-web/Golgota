import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import LogoutButton from "@/components/layout/logout-button";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("nombre, rol, activo")
    .eq("id", user.id)
    .single();

  if (!perfil || !perfil.activo) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">
              Gólgota CF
            </h1>

            <p className="text-sm text-zinc-400">
              Portal de administración
            </p>
          </div>

          <div className="text-right">
            <p className="text-sm font-medium">
              {perfil.nombre}
            </p>

            <p className="text-xs uppercase text-zinc-400">
              {perfil.rol}
            </p>

            <LogoutButton />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}