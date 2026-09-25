import { createClient } from "@/lib/supabase/server";

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

  if (perfilError || !perfil) {
    return (
      <main className="p-6 text-white sm:p-8">
        <p role="alert" className="text-red-300">
          No fue posible determinar el panel disponible para este usuario.
        </p>
      </main>
    );
  }

  if (perfil.rol === "staff") {
    return (
      <main className="p-6 text-white sm:p-8">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-2xl font-bold">Panel operativo</h1>
          <p className="mt-3 text-zinc-400">Panel en construcción</p>
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
      <main className="p-6 text-white sm:p-8">
        <div className="rounded-2xl border border-red-900 bg-red-950/30 p-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p role="alert" className="mt-3 text-red-300">
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
    <main className="p-6 text-white sm:p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <section
              key={card.label}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm"
            >
              <h2 className="text-sm font-medium text-zinc-400">{card.label}</h2>
              <p className="mt-3 text-3xl font-bold tracking-tight">{card.value}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
