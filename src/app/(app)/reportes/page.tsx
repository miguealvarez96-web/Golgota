import { redirect } from "next/navigation";
import ReportsDashboard from "@/components/reportes/reports-dashboard";
import { businessDate } from "@/lib/clientes/model";
import { getReportAccess } from "@/lib/reportes/access";
import { loadManagementReport } from "@/lib/reportes/data";
import { resolveReportPeriod } from "@/lib/reportes/model";

export const dynamic = "force-dynamic";

export default async function ReportesPage({ searchParams }: {
  searchParams: { periodo?: string; desde?: string; hasta?: string };
}) {
  const access = await getReportAccess();
  if (!access) redirect("/");

  const today = businessDate();
  const { period, error: periodError } = resolveReportPeriod({
    periodo: typeof searchParams.periodo === "string" ? searchParams.periodo : undefined,
    desde: typeof searchParams.desde === "string" ? searchParams.desde : undefined,
    hasta: typeof searchParams.hasta === "string" ? searchParams.hasta : undefined,
  }, today);

  try {
    const report = await loadManagementReport(access.supabase, period, today);
    return <ReportsDashboard report={report} periodError={periodError} />;
  } catch {
    return <main className="portal-page">
      <p className="eyebrow">Gestión Gólgota</p>
      <h1 className="page-title mt-2">Reportes</h1>
      <div className="panel mt-6 border-red-200 p-6">
        <p role="alert" className="text-red-700">No fue posible cargar los reportes. Comprueba la conexión y los permisos de las migraciones existentes.</p>
        <a href="/reportes" className="btn-secondary mt-4">Volver a intentar</a>
      </div>
    </main>;
  }
}
