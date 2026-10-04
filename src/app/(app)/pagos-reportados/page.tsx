import ReportedPaymentsManager from "@/components/alumnos/reported-payments-manager";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";
import type { AdminPaymentReport, ReportState } from "@/lib/alumnos/model";

type ReportRow = Omit<AdminPaymentReport, "alumno" | "monto"> & { monto: number | string };

export default async function ReportedPaymentsPage() {
  const access = await getClientAccess();
  if (!access || !canManageClients(access.role)) return <Notice text="No tienes permiso para revisar pagos reportados." />;
  try {
    const { data, error } = await access.supabase.from("reportes_pago_alumno")
      .select("id,cliente_id,membresia_id,monto,fecha_pago,banco_origen,referencia,observacion,estado,created_at,reviewed_at,motivo_rechazo,pago_real_id")
      .order("created_at", { ascending: false });
    if (error) return <Notice text={error.code === "42P01" || error.code === "PGRST205"
      ? "La bandeja requiere aplicar primero la migración del Portal del Alumno."
      : "No fue posible cargar los pagos reportados."} />;
    const rows = (data ?? []) as ReportRow[];
    const ids = Array.from(new Set(rows.map((row) => row.cliente_id)));
    const clients = new Map<string, string>();
    if (ids.length) {
      const result = await access.supabase.from("clientes").select("id,nombre_completo").in("id", ids);
      if (result.error) return <Notice text="No fue posible identificar a los alumnos." />;
      for (const client of result.data ?? []) clients.set(client.id, client.nombre_completo);
    }
    const reports: AdminPaymentReport[] = rows.map((row) => ({
      ...row,
      monto: Number(row.monto),
      estado: row.estado as ReportState,
      alumno: clients.get(row.cliente_id) ?? "Alumno no disponible",
    }));
    return <main className="portal-page">
      <div><p className="eyebrow">Cobranza</p><h1 className="page-title mt-2">Pagos reportados</h1>
        <p className="mt-2 text-sm text-brand-secondary">Revisa transferencias informadas por alumnos. Solo aprobar crea un pago real.</p></div>
      <div className="mt-7"><ReportedPaymentsManager reports={reports} /></div>
    </main>;
  } catch {
    return <Notice text="No fue posible cargar los pagos reportados." />;
  }
}

function Notice({ text }: { text: string }) {
  return <main className="portal-page"><h1 className="page-title">Pagos reportados</h1>
    <div role="alert" className="panel mt-6 p-6">{text}</div></main>;
}
