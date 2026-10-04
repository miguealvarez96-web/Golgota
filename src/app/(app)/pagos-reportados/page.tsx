import ReportedPaymentsManager from "@/components/alumnos/reported-payments-manager";
import { adminPaymentReportsSchema } from "@/lib/alumnos/model";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";

export default async function ReportedPaymentsPage() {
  const access = await getClientAccess();
  if (!access || !canManageClients(access.role)) {
    return <Notice text="No tienes permiso para revisar pagos reportados." />;
  }

  try {
    const { data, error } = await access.supabase.rpc("listar_reportes_pago_revision");
    if (error) {
      return <Notice text={["42P01", "42883", "PGRST202"].includes(error.code)
        ? "La bandeja requiere aplicar primero las migraciones de pagos reportados."
        : "No fue posible cargar los pagos reportados."} />;
    }

    const parsed = adminPaymentReportsSchema.safeParse(data ?? []);
    if (!parsed.success) {
      return <Notice text="La bandeja recibió información con un formato inesperado." />;
    }

    return <main className="portal-page">
      <div>
        <p className="eyebrow">Cobranza</p>
        <h1 className="page-title mt-2">Pagos reportados</h1>
        <p className="mt-2 text-sm text-brand-secondary">
          Revisa transferencias informadas por alumnos. Solo aprobar crea un pago real.
        </p>
      </div>
      <div className="mt-7"><ReportedPaymentsManager reports={parsed.data} /></div>
    </main>;
  } catch {
    return <Notice text="No fue posible cargar los pagos reportados." />;
  }
}

function Notice({ text }: { text: string }) {
  return <main className="portal-page">
    <h1 className="page-title">Pagos reportados</h1>
    <div role="alert" className="panel mt-6 p-6">{text}</div>
  </main>;
}
