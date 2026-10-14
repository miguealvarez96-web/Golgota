import { redirect } from "next/navigation";

import ChallengeManager from "@/components/coaches/challenge-manager";
import { getCoachAccess } from "@/lib/coaches/access";
import { loadManagedChallenges } from "@/lib/deportivo/data";

export default async function ChallengesPage({ searchParams }: { searchParams: { filtro?: string } }) {
  const access = await getCoachAccess();
  if (!access) redirect("/");
  const filter = ["activos", "cerrados", "archivados", "todos"].includes(searchParams.filtro ?? "") ? searchParams.filtro! : "activos";
  const challenges = (await loadManagedChallenges(access)).filter((challenge) => filter === "todos"
    || (filter === "archivados" && challenge.archivado)
    || (filter === "cerrados" && !challenge.archivado && challenge.estado === "CERRADO")
    || (filter === "activos" && !challenge.archivado && challenge.estado !== "CERRADO"));
  return <ChallengeManager challenges={challenges} canLifecycle={access.role === "admin" || access.role === "owner"} filter={filter} />;
}
