import "server-only";
import type { getReportAccess } from "./access";
import {
  confirmedIncomeTotal,
  differenceInDays,
  ecuadorDateFromTimestamp,
  financialTotals,
  periodTimestampBounds,
  stockSummary,
  type IncomeCandidate,
  type ReportPeriod,
} from "./model";
import { loadClientIdentities, loadFinancialMemberships, loadPlanNames } from "@/lib/membresias/data";
import { vigencyLabel, vigencyOf, vigencyPriority, type Vigency } from "@/lib/membresias/grouping";

type Database = NonNullable<Awaited<ReturnType<typeof getReportAccess>>>["supabase"];
type PaymentRow = { monto: number; fecha_pago: string };
type ExpenseRow = { id: string; tipo_gasto: string; descripcion: string; monto: number; fecha_gasto: string };
type ProductRow = { id: string; nombre: string; stock: number; activo: boolean };
type SaleRow = { producto_id: string; cantidad: number; valor_total: number; estado: string; fecha_venta: string };
const batchSize = 500;
export const lowStockThreshold = 5;

export type CollectionItem = {
  membershipId: string;
  clientId: string;
  clientName: string;
  clientDocument: string;
  plan: string;
  balance: number;
  dueDate: string;
  state: Vigency;
  daysUntilDue: number;
};

export type ManagementReport = {
  period: ReportPeriod;
  today: string;
  metrics: {
    activeClients: number;
    activeMemberships: number;
    expiringMemberships: number;
    expiredMemberships: number;
    confirmedIncome: number;
    pendingBalance: number;
    expenses: number;
    net: number;
  };
  membershipDistribution: Array<{ state: Vigency; label: string; count: number }>;
  cashflow: Array<{ date: string; income: number; expenses: number }>;
  collections: CollectionItem[];
  renewals: CollectionItem[];
  stock: {
    units: number;
    low: number;
    out: number;
    items: Array<{ id: string; name: string; stock: number }>;
  };
  expenseDetails: Array<{ id: string; category: string; description: string; amount: number; date: string }>;
  sales: {
    available: boolean;
    ranking: Array<{ productId: string; name: string; units: number; amount: number }>;
  };
};

async function loadPayments(supabase: Database, period: ReportPeriod) {
  const bounds = periodTimestampBounds(period);
  const rows: PaymentRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.from("pagos")
      .select("monto,fecha_pago")
      .gte("fecha_pago", bounds.start).lt("fecha_pago", bounds.endExclusive)
      .order("fecha_pago").range(offset, offset + batchSize - 1);
    if (error) throw new Error("No se pudieron cargar los ingresos confirmados.");
    rows.push(...(data ?? []) as PaymentRow[]);
    if ((data ?? []).length < batchSize) return rows;
  }
}

async function loadExpenses(supabase: Database, period: ReportPeriod) {
  const rows: ExpenseRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.from("gastos")
      .select("id,tipo_gasto,descripcion,monto,fecha_gasto")
      .gte("fecha_gasto", period.start).lte("fecha_gasto", period.end)
      .order("fecha_gasto", { ascending: false }).order("id")
      .range(offset, offset + batchSize - 1);
    if (error) throw new Error("No se pudieron cargar los gastos.");
    rows.push(...(data ?? []) as ExpenseRow[]);
    if ((data ?? []).length < batchSize) return rows;
  }
}

async function loadProducts(supabase: Database) {
  const rows: ProductRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.from("productos")
      .select("id,nombre,stock,activo").order("nombre").order("id")
      .range(offset, offset + batchSize - 1);
    if (error) throw new Error("No se pudo cargar el stock.");
    rows.push(...(data ?? []) as ProductRow[]);
    if ((data ?? []).length < batchSize) return rows;
  }
}

async function loadSales(supabase: Database, period: ReportPeriod) {
  const rows: SaleRow[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.from("ventas")
      .select("producto_id,cantidad,valor_total,estado,fecha_venta")
      .gte("fecha_venta", period.start).lte("fecha_venta", period.end)
      .eq("estado", "PAGADO").order("fecha_venta").range(offset, offset + batchSize - 1);
    if (error) return { available: false, rows: [] as SaleRow[] };
    rows.push(...(data ?? []) as SaleRow[]);
    if ((data ?? []).length < batchSize) return { available: true, rows };
  }
}

function buildCashflow(payments: PaymentRow[], expenses: ExpenseRow[], period: ReportPeriod) {
  const points = new Map<string, { date: string; income: number; expenses: number }>();
  const point = (date: string) => {
    const existing = points.get(date) ?? { date, income: 0, expenses: 0 };
    points.set(date, existing);
    return existing;
  };
  for (const payment of payments) point(ecuadorDateFromTimestamp(payment.fecha_pago)).income += Number(payment.monto);
  for (const expense of expenses) point(expense.fecha_gasto).expenses += Number(expense.monto);
  if (!points.size) point(period.start);
  return Array.from(points.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadManagementReport(supabase: Database, period: ReportPeriod, today: string): Promise<ManagementReport> {
  const [memberships, payments, expenses, products, salesResult, clientCountResult] = await Promise.all([
    loadFinancialMemberships(supabase),
    loadPayments(supabase, period),
    loadExpenses(supabase, period),
    loadProducts(supabase),
    loadSales(supabase, period),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("estado_cliente", "Activo"),
  ]);
  if (clientCountResult.error || clientCountResult.count === null) {
    throw new Error("No se pudo cargar el total de clientes activos.");
  }

  const validMemberships = memberships.filter((membership) => membership.estado_pago !== "CANCELADA");
  const clientIds = Array.from(new Set(validMemberships.map((membership) => membership.cliente_id)));
  const planIds = Array.from(new Set(validMemberships.map((membership) => membership.plan_id)));
  const [clients, plans] = await Promise.all([
    loadClientIdentities(supabase, clientIds),
    loadPlanNames(supabase, planIds),
  ]);

  const states: Vigency[] = ["POR_INICIAR", "VIGENTE", "POR_VENCER", "VENCE_HOY", "VENCIDA"];
  const distribution = states.map((state) => ({
    state,
    label: vigencyLabel(state),
    count: validMemberships.filter((membership) => vigencyOf(membership) === state).length,
  }));
  const pendingBalance = validMemberships.reduce((total, membership) => total + Math.max(0, Number(membership.saldo)), 0);
  const incomeEntries: IncomeCandidate[] = payments.map((payment) => ({ amount: Number(payment.monto), status: "CONFIRMADO" }));
  const totals = financialTotals(incomeEntries, expenses.map((expense) => ({ amount: Number(expense.monto) })), pendingBalance);

  const membershipItems: CollectionItem[] = validMemberships.flatMap((membership) => {
      const client = clients.get(membership.cliente_id);
      if (!client) return [];
      const state = vigencyOf(membership);
      return [{
        membershipId: membership.id,
        clientId: membership.cliente_id,
        clientName: client.nombre_completo,
        clientDocument: client.cedula ?? "",
        plan: plans.get(membership.plan_id) ?? "Plan no disponible",
        balance: Number(membership.saldo),
        dueDate: membership.fecha_fin,
        state,
        daysUntilDue: differenceInDays(today, membership.fecha_fin),
      }];
    });
  const byUrgency = (a: CollectionItem, b: CollectionItem) => vigencyPriority(a.state) - vigencyPriority(b.state)
      || a.dueDate.localeCompare(b.dueDate)
      || a.clientName.localeCompare(b.clientName, "es");
  const collections = membershipItems.filter((membership) => membership.balance > 0).sort(byUrgency);
  const renewals = membershipItems.filter((membership) => membership.state === "VENCE_HOY" || membership.state === "POR_VENCER")
    .sort(byUrgency);

  const activeProducts = products.filter((product) => product.activo);
  const stockTotals = stockSummary(products, lowStockThreshold);
  const stockItems = activeProducts.filter((product) => product.stock <= lowStockThreshold)
    .sort((a, b) => a.stock - b.stock || a.nombre.localeCompare(b.nombre, "es"))
    .map((product) => ({ id: product.id, name: product.nombre, stock: Number(product.stock) }));
  const productNames = new Map(products.map((product) => [product.id, product.nombre]));
  const sales = new Map<string, { units: number; amount: number }>();
  for (const sale of salesResult.rows) {
    const current = sales.get(sale.producto_id) ?? { units: 0, amount: 0 };
    current.units += Number(sale.cantidad);
    current.amount += Number(sale.valor_total);
    sales.set(sale.producto_id, current);
  }
  const ranking = Array.from(sales.entries()).map(([productId, value]) => ({
    productId,
    name: productNames.get(productId) ?? "Producto no disponible",
    ...value,
  })).sort((a, b) => b.units - a.units || b.amount - a.amount || a.name.localeCompare(b.name, "es"));

  return {
    period,
    today,
    metrics: {
      activeClients: clientCountResult.count,
      activeMemberships: distribution.filter((item) => ["VIGENTE", "POR_VENCER", "VENCE_HOY"].includes(item.state))
        .reduce((total, item) => total + item.count, 0),
      expiringMemberships: distribution.find((item) => item.state === "POR_VENCER")?.count ?? 0,
      expiredMemberships: distribution.find((item) => item.state === "VENCIDA")?.count ?? 0,
      confirmedIncome: confirmedIncomeTotal(incomeEntries),
      pendingBalance: totals.pendingBalance,
      expenses: totals.expense,
      net: totals.net,
    },
    membershipDistribution: distribution,
    cashflow: buildCashflow(payments, expenses, period),
    collections,
    renewals,
    stock: { ...stockTotals, items: stockItems },
    expenseDetails: expenses.map((expense) => ({
      id: expense.id,
      category: expense.tipo_gasto,
      description: expense.descripcion,
      amount: Number(expense.monto),
      date: expense.fecha_gasto,
    })),
    sales: { available: salesResult.available, ranking },
  };
}
