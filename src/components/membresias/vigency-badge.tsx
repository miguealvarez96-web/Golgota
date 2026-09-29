import { vigencyLabel, type Vigency } from "@/lib/membresias/grouping";

export default function VigencyBadge({ state }: { state: Vigency }) {
  const urgent = state === "VENCIDA" || state === "VENCE_HOY";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${urgent
    ? "border-brand-copper/50 bg-brand-copper/10 text-brand-text"
    : "border-brand-border bg-brand-bg text-brand-secondary"}`}>{vigencyLabel(state)}</span>;
}
