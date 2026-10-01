import "server-only";
import type { getProductAccess } from "./access";
import { PRODUCT_IMAGE_BUCKET, productSearchFilter, type ProductRow } from "./model";

type ProductAccess = NonNullable<Awaited<ReturnType<typeof getProductAccess>>>;

export type ProductFilters = {
  query: string;
  category: string;
  state: "" | "activo" | "inactivo";
  page: number;
  pageSize: number;
};

export async function loadProductCatalog(access: ProductAccess, filters: ProductFilters) {
  const { supabase, role } = access;
  let request = supabase.from("productos")
    .select("id,nombre,categoria,descripcion,precio,stock,activo,imagen_path,created_at,updated_at", { count: "exact" })
    .order("nombre").order("id")
    .range((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1);

  if (role === "staff") request = request.eq("activo", true);
  else if (filters.state) request = request.eq("activo", filters.state === "activo");
  if (filters.query) request = request.or(productSearchFilter(filters.query));
  if (filters.category) request = request.eq("categoria", filters.category);

  let categoriesRequest = supabase.from("productos").select("categoria")
    .not("categoria", "is", null).order("categoria").limit(1000);
  if (role === "staff") categoriesRequest = categoriesRequest.eq("activo", true);

  const [productsResult, categoriesResult] = await Promise.all([request, categoriesRequest]);
  if (productsResult.error || !productsResult.data || productsResult.count === null) {
    throw new Error("No se pudo cargar el catálogo de productos.");
  }
  if (categoriesResult.error || !categoriesResult.data) {
    throw new Error("No se pudieron cargar las categorías de productos.");
  }

  const rows = productsResult.data as ProductRow[];
  const paths = Array.from(new Set(rows.map((product) => product.imagen_path).filter((path): path is string => Boolean(path))));
  const signedUrls = new Map<string, string>();
  if (paths.length) {
    const signed = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl);
    }
  }

  return {
    products: rows.map((product) => ({
      ...product,
      image_url: product.imagen_path ? signedUrls.get(product.imagen_path) ?? null : null,
    })),
    total: productsResult.count,
    categories: Array.from(new Set(categoriesResult.data
      .map((row) => row.categoria)
      .filter((category): category is string => Boolean(category)))),
  };
}
