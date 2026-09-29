import Link from "next/link";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";
import MembershipForm from "@/components/membresias/membership-form";
import { businessDate, membershipSearchFilter, suggestedRenewalStart } from "@/lib/membresias/model";

export default async function NuevaMembresiaPage({ searchParams }: {
  searchParams: { cliente?: string; q?: string; desde?: string };
}) {
  const access = await getClientAccess();
  if (!access || !canManageClients(access.role)) return <Notice text="No tienes permiso para crear membresías." />;
  const { supabase } = access;
  const clientId = typeof searchParams.cliente === "string" ? searchParams.cliente : "";
  const fromId = typeof searchParams.desde === "string" ? searchParams.desde : "";
  const q = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const clients = q ? await supabase.from("clientes").select("id,nombre_completo,cedula").or(membershipSearchFilter(q)).order("nombre_completo").limit(20) : { data: [], error: null };
  if (clients.error) return <Notice text="No fue posible buscar clientes." />;
  const selected = clientId ? await supabase.from("clientes").select("id,nombre_completo").eq("id", clientId).maybeSingle() : { data: null, error: null };
  if (selected.error) return <Notice text="No fue posible cargar el cliente." />;
  const previous = fromId ? await supabase.from("v_membresias_estado").select("id,cliente_id,plan_id,fecha_inicio,fecha_fin,estado_pago").eq("id", fromId).maybeSingle() : { data: null, error: null };
  if (previous.error || (fromId && (!previous.data || previous.data.cliente_id !== clientId))) return <Notice text="La membresía de origen no corresponde al cliente seleccionado." />;
  const today = businessDate();
  const current = selected.data ? await supabase.from("v_membresias_estado")
    .select("fecha_inicio,fecha_fin,estado_pago").eq("cliente_id", selected.data.id)
    .neq("estado_pago", "CANCELADA").lte("fecha_inicio", today).gte("fecha_fin", today)
    .order("fecha_fin", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null };
  if (current.error) return <Notice text="No fue posible comprobar la membresía vigente del cliente." />;
  const catalog = await supabase.from("planes").select("id,nombre,precio,duracion_dias").eq("activo", true).order("precio");
  if (catalog.error) return <Notice text="No fue posible cargar los planes." />;
  const plans = (catalog.data ?? []).filter((plan) => ["DIARIO", "SEMANAL", "QUINCENAL", "MENSUAL"].includes(plan.nombre.trim().toUpperCase()));
  return <main className="portal-page">
    <Link href="/membresias" className="text-sm text-brand-secondary underline underline-offset-4">← Membresías</Link>
    <h1 className="page-title mt-4">{fromId ? "Renovar membresía" : "Nueva membresía"}</h1>
    <p className="mt-2 text-sm text-brand-secondary">{fromId ? "La renovación crea una nueva membresía y conserva el historial anterior." : "Busca al cliente y selecciona un plan activo."}</p>
    {!selected.data && <form action="/membresias/nueva" role="search" className="panel mt-6 flex max-w-2xl flex-wrap items-end gap-3 p-5">
      <div className="min-w-52 flex-1"><label htmlFor="new-member-client" className="field-label">Buscar cliente</label><input id="new-member-client" name="q" type="search" className="field" placeholder="Nombre o cédula" defaultValue={q} required /></div>
      <button className="btn-secondary" type="submit">Buscar</button>
    </form>}
    {!selected.data && q && <div className="panel mt-4 max-w-2xl divide-y divide-brand-border">{(clients.data ?? []).length ? clients.data!.map((client) => <Link key={client.id} href={`/membresias/nueva?cliente=${client.id}`} className="block px-5 py-4 hover:bg-brand-bg">{client.nombre_completo}<span className="ml-3 text-sm text-brand-secondary">{client.cedula}</span></Link>) : <p className="p-5 text-sm text-brand-secondary">No se encontraron clientes.</p>}</div>}
    {selected.data && (plans.length ? <><Link href="/membresias/nueva" className="mt-5 inline-block text-sm text-brand-secondary underline underline-offset-4">Cambiar cliente</Link><MembershipForm client={selected.data} plans={plans} initialPlanId={previous.data?.plan_id} renewal={Boolean(fromId)} previous={current.data ?? previous.data} suggestedStartDate={suggestedRenewalStart(current.data ?? previous.data, today)} /></> : <div className="panel mt-6 p-6" role="alert">No hay planes disponibles. Revisa el catálogo antes de continuar.</div>)}
  </main>;
}

function Notice({ text }: { text: string }) { return <main className="portal-page"><h1 className="page-title">Nueva membresía</h1><div className="panel mt-6 p-6" role="alert">{text}</div></main>; }
