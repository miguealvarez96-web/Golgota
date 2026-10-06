import { redirect } from "next/navigation";
import InventoryManager from "@/components/inventario/inventory-manager";
import { getInventoryAccess } from "@/lib/inventario/access";
import { loadInventory } from "@/lib/inventario/data";
import { inventoryStates } from "@/lib/inventario/model";

export default async function InventarioPage({ searchParams }: { searchParams: { q?: string; estado?: string } }) {
  const access = await getInventoryAccess();
  if (!access) redirect("/");
  const query = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const state = inventoryStates.find((item) => item === searchParams.estado) ?? "";
  try {
    const data = await loadInventory(access, { query, state });
    return <InventoryManager {...data} query={query} state={state} />;
  } catch {
    return <main className="portal-page"><h1 className="page-title">Inventario</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">No fue posible cargar el inventario. Si la migración está pendiente, aplícala después del dry-run.</p></div></main>;
  }
}
