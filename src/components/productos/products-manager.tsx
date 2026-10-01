"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PortalIcon from "@/components/layout/portal-icon";
import { setProductActive } from "@/app/(app)/productos/actions";
import { productMoneyLabel, type ProductRow } from "@/lib/productos/model";
import ProductForm from "./product-form";

type Props = {
  products: ProductRow[];
  categories: string[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  category: string;
  state: string;
  canManage: boolean;
};

export default function ProductsManager({ products, categories, total, page, pageSize, query, category, state, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ProductRow | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function pageUrl(target: number, q = query, filterCategory = category, filterState = state) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filterCategory) params.set("categoria", filterCategory);
    if (filterState) params.set("estado", filterState);
    if (target > 1) params.set("pagina", String(target));
    return `/productos${params.size ? `?${params}` : ""}`;
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => router.push(pageUrl(1, String(data.get("q") ?? "").trim(), String(data.get("categoria") ?? ""), String(data.get("estado") ?? ""))));
  }

  function open(product: ProductRow | null, element: HTMLElement) {
    opener.current = element;
    setError("");
    setMessage("");
    setForm(product);
  }

  function close() {
    setForm(undefined);
    (opener.current?.isConnected ? opener.current : newButton.current)?.focus();
  }

  function changeState(product: ProductRow) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await setProductActive(product.id, !product.activo);
      if (result.ok) { setMessage(result.message); router.refresh(); }
      else setError(result.message);
    });
  }

  return (
    <main className="portal-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="eyebrow">Catálogo Gólgota</p><h1 className="page-title mt-2">Productos</h1><p className="mt-2 text-sm text-brand-secondary">Catálogo, precios y existencias disponibles.</p></div>
        {canManage && <button ref={newButton} type="button" className="btn-primary" onClick={(event) => open(null, event.currentTarget)}><PortalIcon name="plus" />Nuevo producto</button>}
      </div>

      {message && <p role="status" className="mt-5 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <form key={`${query}:${category}:${state}`} onSubmit={search} className={`panel mt-7 grid items-end gap-4 p-4 sm:p-5 ${canManage ? "md:grid-cols-[minmax(0,1fr)_12rem_10rem_auto]" : "md:grid-cols-[minmax(0,1fr)_12rem_auto]"}`} role="search">
        <div><label htmlFor="product-search" className="field-label">Buscar producto</label><input id="product-search" name="q" type="search" className="field" defaultValue={query} maxLength={100} placeholder="Nombre, categoría o descripción" /></div>
        <div><label htmlFor="product-category-filter" className="field-label">Categoría</label><select id="product-category-filter" name="categoria" defaultValue={category} className="field"><option value="">Todas</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        {canManage && <div><label htmlFor="product-state-filter" className="field-label">Estado</label><select id="product-state-filter" name="estado" defaultValue={state} className="field"><option value="">Todos</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select></div>}
        <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Buscando…" : "Buscar"}</button>
      </form>

      <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-secondary">
        <p role="status">{pending ? "Actualizando resultados…" : `${total.toLocaleString("es-EC")} ${total === 1 ? "producto encontrado" : "productos encontrados"}`}</p>
        {(query || category || state) && <button type="button" className="underline underline-offset-4 hover:text-brand-text" onClick={() => startTransition(() => router.push("/productos"))}>Limpiar filtros</button>}
      </div>

      <div aria-busy={pending} className={pending ? "opacity-60" : ""}>
        {!products.length ? <EmptyProducts canManage={canManage} onCreate={(element) => open(null, element)} /> : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {products.map((product) => <article key={product.id} className="panel flex min-w-0 flex-col overflow-hidden">
              <div className="flex aspect-[4/3] items-center justify-center border-b border-brand-border bg-brand-bg bg-cover bg-center"
                style={product.image_url ? { backgroundImage: `url(${JSON.stringify(product.image_url)})` } : undefined}
                role="img" aria-label={product.image_url ? `Imagen de ${product.nombre}` : `${product.nombre} sin imagen`}>
                {!product.image_url && <div className="flex flex-col items-center gap-2 text-brand-secondary"><PortalIcon name="products" /><span className="text-xs">Sin imagen</span></div>}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.12em] text-brand-secondary">{product.categoria || "Sin categoría"}</p><h2 className="mt-1 break-words text-lg font-semibold text-brand-text">{product.nombre}</h2></div>{canManage && <ProductStatus active={product.activo} />}</div>
                {product.descripcion && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-brand-secondary">{product.descripcion}</p>}
                <dl className="mt-auto grid grid-cols-2 gap-3 pt-5"><div><dt className="text-xs text-brand-secondary">Precio</dt><dd className="mt-1 text-lg font-semibold text-brand-text">{productMoneyLabel(Number(product.precio))}</dd></div><div><dt className="text-xs text-brand-secondary">Stock</dt><dd className="mt-1 text-lg font-semibold text-brand-text">{product.stock.toLocaleString("es-EC")}</dd></div></dl>
                {canManage && <div className="mt-5 grid grid-cols-2 gap-2 border-t border-brand-border pt-4"><button type="button" className="btn-secondary" onClick={(event) => open(product, event.currentTarget)}>Editar</button><button type="button" className="btn-secondary" disabled={pending} onClick={() => changeState(product)}>{product.activo ? "Inactivar" : "Activar"}</button></div>}
              </div>
            </article>)}
          </div>
        )}
      </div>

      {(pages > 1 || page > 1) && <nav aria-label="Páginas de productos" className="mt-7 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-brand-secondary">Página {page} de {pages} · {pageSize} por página</span><div className="flex gap-2">{page > 1 && <button className="btn-secondary" onClick={() => startTransition(() => router.push(pageUrl(page - 1)))}>Anterior</button>}{page < pages && <button className="btn-secondary" onClick={() => startTransition(() => router.push(pageUrl(page + 1)))}>Siguiente</button>}</div></nav>}

      {form !== undefined && <ProductForm product={form} onClose={close} onSaved={(notice) => { close(); setMessage(notice); startTransition(() => router.refresh()); }} />}
    </main>
  );
}

function ProductStatus({ active }: { active: boolean }) {
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${active ? "border-brand-copper/50 bg-brand-copper/10" : "border-brand-border text-brand-secondary"}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-brand-copper" : "bg-brand-muted"}`} />{active ? "Activo" : "Inactivo"}</span>;
}

function EmptyProducts({ canManage, onCreate }: { canManage: boolean; onCreate: (element: HTMLButtonElement) => void }) {
  return <div className="panel py-16 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-brand-copper/50 text-brand-copper"><PortalIcon name="products" /></div><h2 className="text-lg font-semibold">No hay productos para mostrar</h2><p className="mx-auto mt-2 max-w-sm px-4 text-sm text-brand-secondary">Prueba con otros filtros{canManage ? " o registra un producto nuevo" : ""}.</p>{canManage && <button type="button" className="btn-primary mt-5" onClick={(event) => onCreate(event.currentTarget)}><PortalIcon name="plus" />Nuevo producto</button>}</div>;
}
