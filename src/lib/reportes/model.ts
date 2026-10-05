export type ReportPeriodKey = "hoy" | "mes_actual" | "mes_anterior" | "personalizado";
export type ReportPeriod = {
  key: ReportPeriodKey;
  label: string;
  start: string;
  end: string;
};

export type IncomeCandidate = {
  amount: number;
  status: "CONFIRMADO" | "PENDIENTE" | "RECHAZADO";
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validDateOnly(value: string) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthBounds(value: string, shift: number) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 + shift, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function differenceInDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function resolveReportPeriod(input: {
  periodo?: string;
  desde?: string;
  hasta?: string;
}, today: string): { period: ReportPeriod; error: string | null } {
  const key: ReportPeriodKey = ["hoy", "mes_actual", "mes_anterior", "personalizado"].includes(input.periodo ?? "")
    ? input.periodo as ReportPeriodKey : "mes_actual";
  if (key === "hoy") return { period: { key, label: "Hoy", start: today, end: today }, error: null };
  if (key === "mes_actual") {
    const bounds = monthBounds(today, 0);
    return { period: { key, label: "Este mes", ...bounds }, error: null };
  }
  if (key === "mes_anterior") {
    const bounds = monthBounds(today, -1);
    return { period: { key, label: "Mes anterior", ...bounds }, error: null };
  }
  const from = input.desde ?? "";
  const to = input.hasta ?? "";
  if (!validDateOnly(from) || !validDateOnly(to) || from > to) {
    const bounds = monthBounds(today, 0);
    return {
      period: { key: "mes_actual", label: "Este mes", ...bounds },
      error: "El rango personalizado debe incluir fechas válidas y ordenadas.",
    };
  }
  if (differenceInDays(from, to) > 366) {
    const bounds = monthBounds(today, 0);
    return {
      period: { key: "mes_actual", label: "Este mes", ...bounds },
      error: "El rango personalizado no puede superar 367 días.",
    };
  }
  return { period: { key, label: "Rango personalizado", start: from, end: to }, error: null };
}

export function periodTimestampBounds(period: ReportPeriod) {
  return {
    start: `${period.start}T00:00:00-05:00`,
    endExclusive: `${addDateDays(period.end, 1)}T00:00:00-05:00`,
  };
}

export function ecuadorDateFromTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

export function confirmedIncomeTotal(entries: IncomeCandidate[]) {
  return entries.reduce((total, entry) => entry.status === "CONFIRMADO" ? total + Number(entry.amount) : total, 0);
}

export function financialTotals(entries: IncomeCandidate[], expenses: Array<{ amount: number }>, pendingBalance: number) {
  const income = confirmedIncomeTotal(entries);
  const expense = expenses.reduce((total, item) => total + Number(item.amount), 0);
  return { income, expense, net: income - expense, pendingBalance };
}

export function stockSummary(products: Array<{ stock: number; activo: boolean }>, threshold = 5) {
  const active = products.filter((product) => product.activo);
  return {
    units: active.reduce((total, product) => total + Number(product.stock), 0),
    low: active.filter((product) => product.stock > 0 && product.stock <= threshold).length,
    out: active.filter((product) => product.stock === 0).length,
  };
}
