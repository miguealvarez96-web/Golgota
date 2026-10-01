import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import LogoutButton from "@/components/layout/logout-button";
import PortalNavigation from "@/components/layout/portal-navigation";
import Brand from "@/components/layout/brand";
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
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <a href="#portal-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-text focus:p-3 focus:text-white">Ir al contenido</a>
      <header className="border-b border-brand-border bg-brand-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-5 px-4 py-4 sm:px-8 sm:py-5">
          <Brand />
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
            <div className="min-w-0 break-words sm:border-r sm:border-brand-border sm:pr-5 sm:text-right">
              <p className="text-sm font-medium">{perfil.nombre}</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-secondary">
                {perfil.rol}
              </p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] lg:grid lg:min-h-[calc(100vh-88px)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-brand-border bg-brand-surface p-3 sm:p-5 lg:border-b-0 lg:border-r lg:pt-8">
          <div className="lg:sticky lg:top-6">
            <PortalNavigation role={perfil.rol} />
          </div>
        </aside>
        <div id="portal-content" tabIndex={-1} className="min-w-0 break-words">{children}</div>
      </div>
    </div>
  );
}
