"use server";

import { revalidatePath } from "next/cache";
import { getClientAccess } from "@/lib/clientes/access";
import { canManageClients } from "@/lib/clientes/model";
import { createMembershipSchema, ecuadorPaymentTimestamp, registerPaymentSchema, type MutationResult } from "@/lib/membresias/model";

function failure(code?: string): MutationResult {
  return { ok: false, message: code === "PGRST202"
    ? "La operación aún no está disponible. Hay una migración pendiente de revisión."
    : "No se pudo completar la operación. Revisa los datos, el saldo y tus permisos." };
}

export async function createMembership(input: unknown): Promise<MutationResult> {
  try {
    const parsed = createMembershipSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) return { ok: false, message: "No tienes permiso para crear membresías." };
    const value = parsed.data;
    const { data, error } = await access.supabase.rpc("crear_membresia", {
      p_cliente_id: value.cliente_id, p_plan_id: value.plan_id,
      p_fecha_inicio: value.fecha_inicio, p_abono_inicial: value.abono_inicial,
      p_metodo_pago: value.abono_inicial ? value.metodo_pago : null,
      p_fecha_pago: ecuadorPaymentTimestamp(value.fecha_pago),
    });
    if (error?.code === "23P01") return { ok: false, message: "El cliente ya tiene una membresía que se superpone con estas fechas." };
    if (error || !data?.id) return failure(error?.code);
    revalidatePath("/membresias"); revalidatePath("/clientes"); revalidatePath("/");
    return { ok: true, id: data.id, message: "Membresía creada correctamente." };
  } catch { return failure(); }
}

export async function registerPayment(input: unknown): Promise<MutationResult> {
  try {
    const parsed = registerPaymentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos." };
    const access = await getClientAccess();
    if (!access || !canManageClients(access.role)) return { ok: false, message: "No tienes permiso para registrar pagos." };
    const value = parsed.data;
    const { error } = await access.supabase.rpc("registrar_pago", {
      p_membresia_id: value.membresia_id, p_monto: value.monto,
      p_metodo_pago: value.metodo_pago, p_fecha_pago: ecuadorPaymentTimestamp(value.fecha_pago),
    });
    if (error) return failure(error.code);
    revalidatePath(`/membresias/${value.membresia_id}`); revalidatePath("/membresias");
    revalidatePath("/clientes"); revalidatePath("/");
    return { ok: true, id: value.membresia_id, message: "Pago registrado correctamente." };
  } catch { return failure(); }
}
