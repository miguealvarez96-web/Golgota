import WodManager from "@/components/coaches/wod-manager";
import { businessDate } from "@/lib/clientes/model";
import { getCoachAccess } from "@/lib/coaches/access";
import { canManageCoachContent, type WodRow } from "@/lib/coaches/model";

export default async function WodPage() {
  const access = await getCoachAccess();
  if (!access) return <LoadError title="WOD" />;
  const canManage = canManageCoachContent(access.role);
  const today = businessDate();

  let request = access.supabase.from("wods")
    .select("id,fecha,titulo,contenido,publicado,created_by,created_at,updated_at")
    .order("fecha", { ascending: false });
  if (!canManage) request = request.eq("fecha", today).eq("publicado", true);
  const { data, error } = await request.limit(canManage ? 60 : 1);
  if (error || !data) return <LoadError title="WOD" />;

  return <WodManager wods={data as WodRow[]} canManage={canManage} today={today} />;
}

function LoadError({ title }: { title: string }) {
  return <main className="portal-page"><h1 className="page-title">{title}</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">No fue posible cargar el contenido. Si la migración está pendiente, aplícala después de su dry-run.</p></div></main>;
}

