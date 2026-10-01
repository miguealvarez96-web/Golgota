import { redirect } from "next/navigation";

import ModulePlaceholder from "@/components/layout/module-placeholder";
import { getClientAccess } from "@/lib/clientes/access";

export default async function ReportesPage() {
  const access = await getClientAccess();

  if (!access || access.role === "staff") {
    redirect("/");
  }

  return <ModulePlaceholder title="Reportes" />;
}