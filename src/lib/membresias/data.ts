import "server-only";
import type { getClientAccess } from "@/lib/clientes/access";
import type { ClientIdentity, FinancialMembership, OperationalMembership } from "./grouping";

type Database = NonNullable<Awaited<ReturnType<typeof getClientAccess>>>["supabase"];
const batchSize = 500;

export async function loadFinancialMemberships(supabase: Database, clientId?: string) {
  const rows: FinancialMembership[] = [];
  for (let offset = 0; ; offset += batchSize) {
    let request = supabase.from("v_membresias_estado")
      .select("id,cliente_id,plan_id,fecha_inicio,fecha_fin,saldo,estado_pago,estado_vigencia")
      .order("id").range(offset, offset + batchSize - 1);
    if (clientId) request = request.eq("cliente_id", clientId);
    const { data, error } = await request;
    if (error) throw new Error("No se pudieron cargar las membresías.");
    rows.push(...(data ?? []) as FinancialMembership[]);
    if ((data ?? []).length < batchSize) return rows;
  }
}

export async function loadOperationalMemberships(supabase: Database, clientId?: string) {
  const rows: OperationalMembership[] = [];
  for (let offset = 0; ; offset += batchSize) {
    let request = supabase.from("v_membresias_verificacion")
      .select("cliente_id,plan,fecha_fin,estado_vigencia")
      .order("cliente_id").order("fecha_fin").range(offset, offset + batchSize - 1);
    if (clientId) request = request.eq("cliente_id", clientId);
    const { data, error } = await request;
    if (error) throw new Error("No se pudo cargar la vigencia.");
    rows.push(...(data ?? []) as OperationalMembership[]);
    if ((data ?? []).length < batchSize) return rows;
  }
}

export async function loadClientIdentities(supabase: Database, ids: string[]) {
  const clients = new Map<string, ClientIdentity>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabase.from("clientes")
      .select("id,nombre_completo,cedula").in("id", ids.slice(offset, offset + 200));
    if (error) throw new Error("No se pudieron cargar los clientes.");
    for (const client of data ?? []) clients.set(client.id, client);
  }
  return clients;
}

export async function loadPlanNames(supabase: Database, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase.from("planes").select("id,nombre").in("id", ids);
  if (error) throw new Error("No se pudieron cargar los planes.");
  return new Map((data ?? []).map((plan) => [plan.id, plan.nombre]));
}

export async function loadMembershipPayments(supabase: Database, membershipIds: string[]) {
  type Payment = { id: string; membresia_id: string; monto: number; fecha_pago: string; metodo_pago: string };
  const payments = new Map<string, Payment[]>();
  for (let start = 0; start < membershipIds.length; start += 100) {
    const ids = membershipIds.slice(start, start + 100);
    for (let offset = 0; ; offset += batchSize) {
      const { data, error } = await supabase.from("pagos")
        .select("id,membresia_id,monto,fecha_pago,metodo_pago")
        .in("membresia_id", ids).order("id").range(offset, offset + batchSize - 1);
      if (error) throw new Error("No se pudo cargar el historial de pagos.");
      for (const payment of (data ?? []) as Payment[]) {
        const list = payments.get(payment.membresia_id) ?? [];
        list.push(payment);
        payments.set(payment.membresia_id, list);
      }
      if ((data ?? []).length < batchSize) break;
    }
  }
  payments.forEach((list) => list.sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago)));
  return payments;
}
