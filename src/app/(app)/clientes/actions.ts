"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients, clientSchema, type DeleteClientResult, type SaveClientResult } from "@/lib/clientes/model";

export async function saveClient(id: string | null, input: unknown): Promise<SaveClientResult> {
  try {
    const access = await getClientAccess();
    if (!access) return { ok: false, message: "Tu sesión no permite gestionar clientes. Vuelve a iniciar sesión." };
    if (id !== null && (!z.string().uuid().safeParse(id).success || !canManageClients(access.role))) {
      return { ok: false, message: "No tienes permiso para editar este cliente." };
    }
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    const { supabase, userId } = access;

    let duplicateQuery = supabase.from("clientes").select("id").eq("cedula", parsed.data.cedula);
    if (id) duplicateQuery = duplicateQuery.neq("id", id);
    const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
    if (duplicateError) return { ok: false, message: "No fue posible comprobar la identificación. Inténtalo de nuevo." };
    if (duplicate) return { ok: false, message: "Ya existe un cliente con esa identificación.", errors: { cedula: ["Esta identificación ya está registrada."] } };

    // Lista explícita validada: no acepta IDs de cuenta, created_by, metadatos
    // financieros ni campos fuera del formulario. RLS es una segunda barrera.
    const result = id
      ? await supabase.from("clientes").update(parsed.data).eq("id", id).select("id").single()
      : await supabase.from("clientes").insert({ ...parsed.data, created_by: userId }).select("id").single();

    if (result.error) {
      if (result.error.code === "23505") return { ok: false, message: "Ya existe un cliente con esa identificación.", errors: { cedula: ["Esta identificación ya está registrada."] } };
      if (result.error.code === "42501" || result.error.code === "PGRST116") return { ok: false, message: "No se pudo guardar el cliente. Verifica tus permisos o actualiza el listado." };
      return { ok: false, message: "No fue posible guardar el cliente. Inténtalo de nuevo." };
    }
    if (!result.data) return { ok: false, message: "No se confirmó el cambio. Actualiza el listado antes de volver a intentarlo." };
    revalidatePath("/clientes");
    revalidatePath("/");
    return { ok: true, message: id ? "Cliente actualizado correctamente." : "Cliente creado correctamente." };
  } catch {
    return { ok: false, message: "No fue posible completar la operación. Comprueba tu conexión e inténtalo de nuevo." };
  }
}

export async function deleteClient(id: string): Promise<DeleteClientResult> {
  try {
    if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "El cliente indicado no es válido." };
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) return { ok: false, message: "No tienes permiso para eliminar clientes." };
    const { data, error } = await access.supabase.rpc("eliminar_cliente_seguro", { p_cliente_id: id });
    if (error || !data || typeof data !== "object") return { ok: false, message: "No fue posible eliminar el cliente de forma segura." };
    const mode = (data as { modo?: unknown }).modo;
    if (mode !== "LOGICA" && mode !== "FISICA") return { ok: false, message: "No se confirmó el tipo de eliminación realizada." };
    revalidatePath("/clientes");
    revalidatePath("/");
    return mode === "LOGICA"
      ? { ok: true, mode, message: "Cliente eliminado de la operación. Su historial se conserva por seguridad y trazabilidad." }
      : { ok: true, mode, message: "Cliente creado por error eliminado definitivamente. La operación quedó auditada." };
  } catch {
    return { ok: false, message: "No fue posible completar la eliminación. Comprueba tu conexión e inténtalo de nuevo." };
  }
}

export async function restoreClient(id: string): Promise<DeleteClientResult> {
  try {
    if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "El cliente indicado no es válido." };
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) return { ok: false, message: "No tienes permiso para restaurar clientes." };
    const { data, error } = await access.supabase.rpc("restaurar_cliente", { p_cliente_id: id });
    if (error || !data) return { ok: false, message: "No fue posible restaurar el cliente." };
    revalidatePath("/clientes"); revalidatePath("/");
    return { ok: true, mode: "LOGICA", message: "Cliente reactivado correctamente." };
  } catch {
    return { ok: false, message: "No fue posible restaurar el cliente." };
  }
}
