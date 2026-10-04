import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: perfil, error: perfilError } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", user?.id ?? "")
    .single();

  if (!perfilError && perfil?.rol === "alumno") {
    redirect("/portal");
  }

  if (perfilError || !perfil || !["admin", "owner", "staff"].includes(perfil.rol)) {
    return (
      <main className="portal-page">
        <p role="alert" className="text-red-700">
          No fue posible determinar el panel disponible para este usuario.
        </p>
      </main>
    );
  }

  if (perfil.rol === "staff") {
    return (
      <main className="portal-page">
        <div className="panel p-6">
          <h1 className="page-title">Panel operativo</h1>
          <p className="mt-3 text-brand-secondary">Panel en construcción</p>
        </div>
      </main>
    );
  }

  const { data: kpis, error } = await supabase
    .from("v_dashboard_kpis")
    .select(
      "clientes_activos, membresias_vigentes, membresias_por_vencer, ingresos_mes, pagos_pendientes"
    )
    .single();

  if (error || !kpis) {
    return (
      <main className="portal-page">
        <div className="panel border-red-200 p-6">
          <h1 className="page-title">Dashboard</h1>
          <p role="alert" className="mt-3 text-red-700">
            No fue posible cargar los indicadores del Dashboard.
          </p>
        </div>
      </main>
    );
  }

  const currency = new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
  });

  const cards = [
    { label: "Clientes activos", value: kpis.clientes_activos.toLocaleString("es-EC") },
    { label: "Membresías vigentes", value: kpis.membresias_vigentes.toLocaleString("es-EC") },
    { label: "Membresías por vencer", value: kpis.membresias_por_vencer.toLocaleString("es-EC") },
    { label: "Ingresos del mes", value: currency.format(Number(kpis.ingresos_mes)) },
    { label: "Pagos pendientes", value: currency.format(Number(kpis.pagos_pendientes)) },
  ];

  return (
    <main className="portal-page">
      <div>
        <p className="eyebrow">Gólgota CF · Resumen</p>
        <h1 className="page-title mt-2">Dashboard</h1>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <section
              key={card.label}
              className="panel relative min-w-0 overflow-hidden p-6 before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:rounded-full before:bg-brand-copper sm:p-7"
            >
              <h2 className="text-sm font-medium text-brand-secondary">{card.label}</h2>
              <p className="mt-6 break-words text-3xl font-semibold tabular-nums tracking-tight text-brand-text sm:text-4xl">{card.value}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
