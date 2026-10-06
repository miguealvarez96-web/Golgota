import "server-only";
import type { getExpenseAccess } from "./access";
import { expenseSearchFilter, type ExpenseRow } from "./model";

type Database = NonNullable<Awaited<ReturnType<typeof getExpenseAccess>>>["supabase"];
export type ExpenseFilters = { query: string; category: string; from: string; to: string };
const batchSize = 500;

export async function loadExpenses(supabase: Database, filters: ExpenseFilters) {
  const rows: ExpenseRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    let request = supabase.from("gastos")
      .select("id,fecha_gasto,tipo_gasto,descripcion,monto,metodo_pago,proveedor,observacion,estado,created_by,updated_by,anulado_por,anulado_at,created_at,updated_at")
      .order("fecha_gasto", { ascending: false }).order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (filters.query) request = request.or(expenseSearchFilter(filters.query));
    if (filters.category) request = request.eq("tipo_gasto", filters.category);
    if (filters.from) request = request.gte("fecha_gasto", filters.from);
    if (filters.to) request = request.lte("fecha_gasto", filters.to);
    const { data, error } = await request;
    if (error) throw new Error("No se pudieron cargar los gastos.");
    rows.push(...(data ?? []) as ExpenseRow[]);
    if ((data ?? []).length < batchSize) break;
  }
  return {
    expenses: rows,
    totalActive: rows.reduce((total, row) => row.estado === "ACTIVO" ? total + Number(row.monto) : total, 0),
  };
}
