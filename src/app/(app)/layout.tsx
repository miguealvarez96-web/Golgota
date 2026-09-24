import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import LogoutButton from "@/components/layout/logout-button";
import PortalNavigation from "@/components/layout/portal-navigation";
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">
              Gólgota CF
            </h1>

            <p className="text-sm text-zinc-400">
              Portal de administración
            </p>
          </div>

          <div className="min-w-0 break-words sm:text-right">
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

      <div className="mx-auto max-w-7xl lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="border-b border-zinc-800 bg-zinc-900/50 p-4 lg:border-b-0 lg:border-r">
          <div className="lg:sticky lg:top-4">
            <PortalNavigation />
          </div>
        </aside>
        <div className="min-w-0 break-words">{children}</div>
      </div>
    </div>
  );
}
