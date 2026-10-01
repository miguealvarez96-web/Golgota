"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { saveProduct } from "@/app/(app)/productos/actions";
import {
  productImageMetadataError,
  productInputFromFormData,
  productSchema,
  type ProductInput,
  type ProductRow,
} from "@/lib/productos/model";

type FieldName = keyof ProductInput | "imagen";

export default function ProductForm({ product, onClose, onSaved }: {
  product: ProductRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string[]>>>({});
  const [preview, setPreview] = useState(product?.image_url ?? "");
  const [objectUrl, setObjectUrl] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const errorSummary = useRef<HTMLParagraphElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = event.target.files?.[0] ?? null;
    const imageError = productImageMetadataError(file);
    setErrors((current) => ({ ...current, imagen: imageError ? [imageError] : undefined }));
    if (imageError || !file) {
      setObjectUrl("");
      setPreview(removeImage ? "" : product?.image_url ?? "");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setObjectUrl(nextUrl);
    setPreview(nextUrl);
    setRemoveImage(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    data.set("remove_image", removeImage ? "true" : "false");
    const validation = productSchema.safeParse(productInputFromFormData(data));
    const file = data.get("imagen");
    const imageError = !removeImage && file && typeof file !== "string" && file.size > 0
      ? productImageMetadataError(file) : null;
    setError("");
    setErrors({});
    if (!validation.success || imageError) {
      setErrors({ ...validation.error?.flatten().fieldErrors, imagen: imageError ? [imageError] : undefined });
      setError("Revisa los campos señalados.");
      return;
    }

    busy.current = true;
    setPending(true);
    try {
      const result = await saveProduct(product?.id ?? null, data);
      if (result.ok) onSaved(result.message);
      else { setError(result.message); setErrors(result.errors ?? {}); }
    } catch {
      setError("No fue posible guardar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function fieldError(name: FieldName) {
    return errors[name]?.length
      ? <p id={`${name}-error`} className="mt-1.5 text-sm text-red-700">{errors[name]?.[0]}</p>
      : null;
  }

  return (
    <dialog ref={dialog} aria-labelledby="product-form-title" aria-describedby="product-form-description"
      onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
      className="panel m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto p-0 text-brand-text backdrop:bg-brand-text/30 backdrop:backdrop-blur-sm">
      <form onSubmit={submit} noValidate className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow">Gólgota CF · Productos</p><h2 id="product-form-title" className="page-title mt-2">{product ? "Editar producto" : "Nuevo producto"}</h2></div>
          <button type="button" onClick={onClose} disabled={pending} className="btn-secondary" aria-label="Cerrar formulario">✕</button>
        </div>
        <p id="product-form-description" className="mt-3 text-sm text-brand-secondary">Los campos con * son obligatorios. La imagen es opcional.</p>
        {error && <p ref={errorSummary} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <fieldset disabled={pending} className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label htmlFor="product-name" className="field-label">Nombre *</label>
              <input autoFocus id="product-name" name="nombre" className="field" required maxLength={255} defaultValue={product?.nombre ?? ""} aria-invalid={Boolean(errors.nombre)} aria-describedby={errors.nombre ? "nombre-error" : undefined} />{fieldError("nombre")}</div>
            <div><label htmlFor="product-category" className="field-label">Categoría</label>
              <input id="product-category" name="categoria" className="field" maxLength={100} defaultValue={product?.categoria ?? ""} aria-invalid={Boolean(errors.categoria)} aria-describedby={errors.categoria ? "categoria-error" : undefined} />{fieldError("categoria")}</div>
            <div><label htmlFor="product-price" className="field-label">Precio (USD) *</label>
              <input id="product-price" name="precio" type="number" inputMode="decimal" min="0.01" max="99999999.99" step="0.01" className="field" required defaultValue={product ? Number(product.precio).toFixed(2) : ""} aria-invalid={Boolean(errors.precio)} aria-describedby={errors.precio ? "precio-error" : undefined} />{fieldError("precio")}</div>
            <div><label htmlFor="product-stock" className="field-label">Stock *</label>
              <input id="product-stock" name="stock" type="number" inputMode="numeric" min="0" max="2147483647" step="1" className="field" required defaultValue={product?.stock ?? 0} aria-invalid={Boolean(errors.stock)} aria-describedby={errors.stock ? "stock-error" : undefined} />{fieldError("stock")}</div>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-brand-border px-3 py-2.5 text-sm font-medium">
              <input name="activo" type="checkbox" defaultChecked={product?.activo ?? true} className="h-4 w-4 accent-brand-copper" />Producto activo
            </label>
            <div className="sm:col-span-2"><label htmlFor="product-description" className="field-label">Descripción</label>
              <textarea id="product-description" name="descripcion" className="field min-h-28 resize-y" maxLength={2000} defaultValue={product?.descripcion ?? ""} aria-invalid={Boolean(errors.descripcion)} aria-describedby={errors.descripcion ? "descripcion-error" : undefined} />{fieldError("descripcion")}</div>
          </div>

          <div>
            <span className="field-label">Imagen principal</span>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-brand-border bg-brand-bg bg-cover bg-center"
              style={preview ? { backgroundImage: `url(${JSON.stringify(preview)})` } : undefined}
              role="img" aria-label={preview ? `Vista previa de ${product?.nombre ?? "producto"}` : "Producto sin imagen"}>
              {!preview && <span className="px-4 text-center text-sm text-brand-secondary">Sin imagen</span>}
            </div>
            <label htmlFor="product-image" className="btn-secondary mt-3 w-full cursor-pointer">Seleccionar imagen</label>
            <input id="product-image" name="imagen" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={selectImage} aria-describedby="product-image-help imagen-error" />
            <p id="product-image-help" className="mt-2 text-xs leading-relaxed text-brand-secondary">JPG, PNG o WEBP. Máximo 2 MB.</p>
            {fieldError("imagen")}
            {product?.imagen_path && <label className="mt-3 flex items-start gap-2 text-sm text-brand-secondary">
              <input type="checkbox" checked={removeImage} className="mt-0.5 h-4 w-4 accent-brand-copper" onChange={(event) => {
                setRemoveImage(event.target.checked);
                if (event.target.checked) setPreview("");
                else if (!objectUrl) setPreview(product.image_url ?? "");
              }} />Retirar imagen actual
            </label>}
          </div>
        </fieldset>

        <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-brand-border pt-5">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}</button>
        </div>
      </form>
    </dialog>
  );
}
