import StudentDashboard from "@/components/alumnos/student-dashboard";
import { loadStudentPortal } from "@/lib/alumnos/access";
import { businessDate } from "@/lib/clientes/model";
import { loadStudentPrivacy } from "@/lib/privacidad/data";
import type { WodRow } from "@/lib/coaches/model";

export default async function StudentPortalPage() {
  const result = await loadStudentPortal();
  if (!result.data) return <main className="portal-page">
    <p className="eyebrow">Portal del alumno</p><h1 className="page-title mt-2">Mi cuenta</h1>
    <div role="alert" className="panel mt-6 border-red-200 p-6 text-red-700">{result.error}</div>
  </main>;
  const [privacy, wodResult] = await Promise.all([
    loadStudentPrivacy(result.access!),
    result.access!.supabase.from("wods")
      .select("id,fecha,titulo,contenido,horario_grupo,youtube_url,notas,publicado")
      .eq("fecha", businessDate()).eq("publicado", true).maybeSingle(),
  ]);
  const wod = wodResult.error ? null : wodResult.data as Pick<WodRow, "id" | "fecha" | "titulo" | "contenido" | "horario_grupo" | "youtube_url" | "notas" | "publicado"> | null;
  return <StudentDashboard data={result.data} privacy={privacy} wod={wod} />;
}
