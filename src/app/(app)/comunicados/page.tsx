import AnnouncementsManager from "@/components/coaches/announcements-manager";
import { getCoachAccess } from "@/lib/coaches/access";
import { canManageCoachContent, type AnnouncementRow } from "@/lib/coaches/model";

export default async function AnnouncementsPage({ searchParams }: { searchParams: { filtro?: string } }) {
  const access = await getCoachAccess();
  if (!access) return <LoadError />;
  const canManage = canManageCoachContent(access.role);
  const canLifecycle = access.role === "admin" || access.role === "owner";
  const filter = searchParams.filtro === "archivados" || searchParams.filtro === "todos" ? searchParams.filtro : "publicados";

  let request = access.supabase.from("comunicados")
    .select("id,titulo,contenido,publicado,archivado,fecha_publicacion,created_by,created_at,updated_at")
    .order("fecha_publicacion", { ascending: false, nullsFirst: false });
  if (!canManage) request = request.eq("publicado", true).lte("fecha_publicacion", new Date().toISOString()).eq("archivado", false);
  else if (filter === "archivados") request = request.eq("archivado", true);
  else if (filter === "publicados") request = request.eq("archivado", false).eq("publicado", true);
  const { data, error } = await request.limit(50);
  if (error || !data) return <LoadError />;

  return <AnnouncementsManager announcements={data as AnnouncementRow[]} canManage={canManage} canLifecycle={canLifecycle} filter={filter} />;
}

function LoadError() {
  return <main className="portal-page"><h1 className="page-title">Comunicados</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">No fue posible cargar los comunicados. Si la migración está pendiente, aplícala después de su dry-run.</p></div></main>;
}
