import { redirect } from "next/navigation";

import ChallengeManager from "@/components/coaches/challenge-manager";
import { getCoachAccess } from "@/lib/coaches/access";
import { loadManagedChallenges } from "@/lib/deportivo/data";

export default async function ChallengesPage() {
  const access = await getCoachAccess();
  if (!access) redirect("/");
  const challenges = await loadManagedChallenges(access);
  return <ChallengeManager challenges={challenges} />;
}
