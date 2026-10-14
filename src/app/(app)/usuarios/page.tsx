import { redirect } from "next/navigation";

import InternalUsersManager from "@/components/usuarios-internos/internal-users-manager";
import { getInternalUsersAdminAccess } from "@/lib/usuarios-internos/access";
import type { InternalUserRow } from "@/lib/usuarios-internos/model";

export default async function UsuariosPage({ searchParams }: { searchParams: { estado?: string } }) {
  const access = await getInternalUsersAdminAccess();
  if (!access) redirect("/");

  const state = searchParams.estado === "activo" || searchParams.estado === "inactivo" ? searchParams.estado : "";
  let request = access.supabase.from("usuarios")
    .select("id,nombre,login_username,rol,activo,created_at")
    .not("login_username", "is", null)
    .in("rol", ["owner", "staff"])
    .order("nombre");
  if (state) request = request.eq("activo", state === "activo");
  const { data, error } = await request;

  return <InternalUsersManager users={(data ?? []) as InternalUserRow[]} loadError={error ? "No fue posible cargar los usuarios internos." : ""} state={state} />;
}
