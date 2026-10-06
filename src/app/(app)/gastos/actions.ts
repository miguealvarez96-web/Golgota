"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getExpenseAccess } from "@/lib/gastos/access";
import { canManageExpenses, expenseSchema, type ExpenseResult } from "@/lib/gastos/model";

const idSchema = z.string().uuid();

export async function saveExpense(id: string | null, input: unknown): Promise<ExpenseResult> {
  try {
    const access = await getExpenseAccess();
    if (!access || !canManageExpenses(access.role)) return { ok: false, message: "No tienes permiso para administrar gastos." };
    if (id !== null && !idSchema.safeParse(id).success) return { ok: false, message: "El gasto indicado no es válido." };
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    const payload = {
      fecha_gasto: parsed.data.fecha,
      tipo_gasto: parsed.data.categoria,
      descripcion: parsed.data.descripcion,
      monto: parsed.data.monto,
      metodo_pago: parsed.data.metodo_pago,
      proveedor: parsed.data.proveedor,
      observacion: parsed.data.observacion,
    };
    const result = id
      ? await access.supabase.from("gastos").update(payload).eq("id", id).eq("estado", "ACTIVO").select("id").single()
      : await access.supabase.from("gastos").insert({ ...payload, created_by: access.userId }).select("id").single();
    if (result.error || !result.data) return { ok: false, message: "No fue posible guardar el gasto. Revisa los datos y tus permisos." };
    revalidatePath("/gastos");
    revalidatePath("/reportes");
    return { ok: true, id: result.data.id, message: id ? "Gasto actualizado." : "Gasto registrado." };
  } catch {
    return { ok: false, message: "No fue posible completar la operación." };
  }
}

export async function voidExpense(id: string): Promise<ExpenseResult> {
  try {
    const access = await getExpenseAccess();
    if (!access || !canManageExpenses(access.role)) return { ok: false, message: "No tienes permiso para anular gastos." };
    if (!idSchema.safeParse(id).success) return { ok: false, message: "El gasto indicado no es válido." };
    const { data, error } = await access.supabase.from("gastos")
      .update({ estado: "ANULADO", anulado_por: access.userId, anulado_at: new Date().toISOString() })
      .eq("id", id).eq("estado", "ACTIVO").select("id").single();
    if (error || !data) return { ok: false, message: "No fue posible anular el gasto o ya estaba anulado." };
    revalidatePath("/gastos");
    revalidatePath("/reportes");
    return { ok: true, id: data.id, message: "Gasto anulado; el historial se conserva." };
  } catch {
    return { ok: false, message: "No fue posible anular el gasto." };
  }
}
