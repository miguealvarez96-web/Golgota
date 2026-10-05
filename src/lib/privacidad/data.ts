import "server-only";
import type { getStudentAccess } from "@/lib/alumnos/access";
import type { getPrivacyManagementAccess } from "./access";
import {
  managementPrivacyRequestsSchema,
  type ManagementPrivacyRequest,
  type PrivacyAcceptance,
  type StudentPrivacyData,
  type StudentPrivacyRequest,
} from "./model";

type StudentAccess = NonNullable<Awaited<ReturnType<typeof getStudentAccess>>>;
type ManagementAccess = NonNullable<Awaited<ReturnType<typeof getPrivacyManagementAccess>>>;
const pendingCodes = ["42P01", "42883", "PGRST202", "PGRST205"];

export async function loadStudentPrivacy(access: StudentAccess): Promise<StudentPrivacyData> {
  const [acceptanceResult, requestsResult] = await Promise.all([
    access.supabase.from("privacidad_aceptaciones")
      .select("id,aviso_version,accepted_at,contexto,finalidades_aceptadas,comunicaciones_promocionales")
      .eq("usuario_id", access.userId).order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    access.supabase.from("privacidad_solicitudes")
      .select("id,tipo,descripcion,estado,created_at,reviewed_at,respuesta")
      .eq("usuario_id", access.userId).order("created_at", { ascending: false }).limit(100),
  ]);
  const error = acceptanceResult.error ?? requestsResult.error;
  if (error) {
    const pending = pendingCodes.includes(error.code);
    return { available: false, acceptance: null, requests: [], error: pending
      ? "La sección de privacidad estará disponible cuando se aplique la migración del BLOQUE 6."
      : "No fue posible cargar tu información de privacidad." };
  }
  return {
    available: true,
    acceptance: acceptanceResult.data as PrivacyAcceptance | null,
    requests: (requestsResult.data ?? []) as StudentPrivacyRequest[],
    error: null,
  };
}

export async function loadManagementPrivacyRequests(access: ManagementAccess): Promise<{
  data: ManagementPrivacyRequest[] | null;
  error: string | null;
}> {
  const result = await access.supabase.rpc("listar_solicitudes_privacidad");
  if (result.error) return { data: null, error: pendingCodes.includes(result.error.code)
    ? "La bandeja requiere aplicar la migración del BLOQUE 6."
    : "No fue posible cargar las solicitudes de privacidad." };
  const parsed = managementPrivacyRequestsSchema.safeParse(result.data ?? []);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: "La bandeja recibió información con un formato inesperado." };
}
