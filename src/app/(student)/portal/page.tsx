import StudentDashboard from "@/components/alumnos/student-dashboard";
import { loadStudentPortal } from "@/lib/alumnos/access";
import { loadStudentPrivacy } from "@/lib/privacidad/data";

export default async function StudentPortalPage() {
  const result = await loadStudentPortal();
  if (!result.data) return <main className="portal-page">
    <p className="eyebrow">Portal del alumno</p><h1 className="page-title mt-2">Mi cuenta</h1>
    <div role="alert" className="panel mt-6 border-red-200 p-6 text-red-700">{result.error}</div>
  </main>;
  const privacy = await loadStudentPrivacy(result.access!);
  return <StudentDashboard data={result.data} privacy={privacy} />;
}
