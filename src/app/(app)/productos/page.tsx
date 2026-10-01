import ProductsManager from "@/components/productos/products-manager";
import { getProductAccess } from "@/lib/productos/access";
import { loadProductCatalog } from "@/lib/productos/data";
import { canManageProducts, productStates } from "@/lib/productos/model";

export default async function ProductosPage({ searchParams }: {
  searchParams: { q?: string; categoria?: string; estado?: string; pagina?: string };
}) {
  const query = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const category = typeof searchParams.categoria === "string" ? searchParams.categoria.trim().slice(0, 100) : "";
  const state = productStates.find((value) => value === searchParams.estado) ?? "";
  const requestedPage = Number(searchParams.pagina);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1;
  const pageSize = 12;

  try {
    const access = await getProductAccess();
    if (!access) return <ProductLoadError message="Tu sesión no permite consultar productos. Vuelve a iniciar sesión." />;
    const canManage = canManageProducts(access.role);
    const catalog = await loadProductCatalog(access, {
      query, category, state: canManage ? state : "activo", page, pageSize,
    });
    return <ProductsManager {...catalog} page={page} pageSize={pageSize} query={query}
      category={category} state={canManage ? state : ""} canManage={canManage} />;
  } catch {
    return <ProductLoadError message="No fue posible cargar los productos. Si la migración está pendiente, aplícala después de su revisión y dry-run." />;
  }
}

function ProductLoadError({ message }: { message: string }) {
  return <main className="portal-page"><h1 className="page-title">Productos</h1><div className="panel mt-6 p-6"><p role="alert" className="text-brand-secondary">{message}</p><a href="/productos" className="btn-secondary mt-4">Volver a cargar</a></div></main>;
}
