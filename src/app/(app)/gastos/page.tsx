import { redirect } from "next/navigation";
import ExpensesManager from "@/components/gastos/expenses-manager";
import { getExpenseAccess } from "@/lib/gastos/access";
import { loadExpenses } from "@/lib/gastos/data";
import { expenseCategories } from "@/lib/gastos/model";
import { validDateOnly } from "@/lib/reportes/model";

export default async function GastosPage({ searchParams }: {
  searchParams: { q?: string; categoria?: string; desde?: string; hasta?: string };
}) {
  const access = await getExpenseAccess();
  if (!access) redirect("/");
  const query = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const category = expenseCategories.find((item) => item === searchParams.categoria) ?? "";
  const from = typeof searchParams.desde === "string" && validDateOnly(searchParams.desde) ? searchParams.desde : "";
  const to = typeof searchParams.hasta === "string" && validDateOnly(searchParams.hasta) ? searchParams.hasta : "";
  try {
    const data = await loadExpenses(access.supabase, { query, category, from, to });
    return <ExpensesManager {...data} query={query} category={category} from={from} to={to} />;
  } catch {
    return <main className="portal-page"><h1 className="page-title">Gastos</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">No fue posible cargar los gastos. Si la migración está pendiente, aplícala después del dry-run.</p></div></main>;
  }
}
