import WodManager from "@/components/coaches/wod-manager";
import { businessDate } from "@/lib/clientes/model";
import { getCoachAccess } from "@/lib/coaches/access";
import { canManageWodContent, type WodRow } from "@/lib/coaches/model";
import { loadCoachSportOverview } from "@/lib/deportivo/data";

export default async function WodPage({ searchParams }: { searchParams: { filtro?: string } }) {
  const access = await getCoachAccess();
  if (!access) return <LoadError title="WOD" />;
  const canManage = canManageWodContent(access.role);
  const canLifecycle = access.role === "admin" || access.role === "owner";
  const filter = searchParams.filtro === "archivados" || searchParams.filtro === "todos" ? searchParams.filtro : "publicados";
  const today = businessDate();

  let request = access.supabase.from("wods")
    .select("id,fecha,titulo,contenido,horario_grupo,youtube_url,notas,benchmark_ref,permite_resultados,limite_tiempo_minutos,publicado,archivado,created_by,created_at,updated_at")
    .order("fecha", { ascending: false });
  if (!canManage) request = request.eq("fecha", today).eq("publicado", true).eq("archivado", false);
  else if (canLifecycle && filter === "archivados") request = request.eq("archivado", true);
  else if (canLifecycle && filter === "publicados") request = request.eq("archivado", false).eq("publicado", true);
  const { data, error } = await request.limit(canManage ? 60 : 1);
  if (error || !data) return <LoadError title="WOD" />;

  const sportOverview = await loadCoachSportOverview(access);
  return <WodManager wods={data as WodRow[]} canManage={canManage} canLifecycle={canLifecycle} filter={filter} today={today} sportOverview={sportOverview} />;
}

function LoadError({ title }: { title: string }) {
  return <main className="portal-page"><h1 className="page-title">{title}</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">No fue posible cargar el contenido. Si la migración está pendiente, aplícala después de su dry-run.</p></div></main>;
}
