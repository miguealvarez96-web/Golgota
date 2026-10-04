import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Brand from "@/components/layout/brand";
import LogoutButton from "@/components/layout/logout-button";
import { getStudentAccess } from "@/lib/alumnos/access";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const access = await getStudentAccess();
  if (!access) redirect("/");
  return <div className="min-h-screen bg-brand-bg text-brand-text">
    <a href="#student-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-text focus:p-3 focus:text-white">Ir al contenido</a>
    <header className="border-b border-brand-border bg-brand-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-5">
        <Brand subtitle="Portal del alumno" />
        <div className="flex min-w-0 items-center gap-4">
          <div className="hidden min-w-0 text-right sm:block"><p className="truncate text-sm font-medium">{access.name}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-secondary">Alumno</p></div>
          <LogoutButton />
        </div>
      </div>
    </header>
    <div id="student-content" tabIndex={-1}>{children}</div>
  </div>;
}
