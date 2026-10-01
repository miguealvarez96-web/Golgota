"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProductAccess } from "@/lib/productos/access";
import {
  PRODUCT_IMAGE_BUCKET,
  canManageProducts,
  productImageContentError,
  productImageExtension,
  productInputFromFormData,
  productSchema,
  type ProductImageLike,
  type SaveProductResult,
} from "@/lib/productos/model";

const productIdSchema = z.string().uuid();

function imageFrom(data: FormData): (File & ProductImageLike) | null {
  const value = data.get("imagen");
  if (!value || typeof value === "string" || typeof value.arrayBuffer !== "function") return null;
  return value as File & ProductImageLike;
}

async function removeStoredImage(access: NonNullable<Awaited<ReturnType<typeof getProductAccess>>>, path: string) {
  return access.supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
}

export async function saveProduct(id: string | null, data: FormData): Promise<SaveProductResult> {
  try {
    const access = await getProductAccess();
    if (!access || !canManageProducts(access.role)) {
      return { ok: false, message: "No tienes permiso para administrar productos." };
    }
    if (id !== null && !productIdSchema.safeParse(id).success) {
      return { ok: false, message: "El producto indicado no es válido." };
    }

    const parsed = productSchema.safeParse(productInputFromFormData(data));
    if (!parsed.success) {
      return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
    }

    const removeImage = data.get("remove_image") === "true";
    const image = removeImage ? null : imageFrom(data);
    const imageError = await productImageContentError(image);
    if (imageError) return { ok: false, message: "Revisa la imagen seleccionada.", errors: { imagen: [imageError] } };

    let currentImage: string | null = null;
    if (id) {
      const current = await access.supabase.from("productos").select("id,imagen_path").eq("id", id).single();
      if (current.error || !current.data) return { ok: false, message: "No se encontró el producto o no puedes editarlo." };
      currentImage = current.data.imagen_path;
    }

    let uploadedPath: string | null = null;
    if (image && image.size > 0) {
      uploadedPath = `${access.userId}/${randomUUID()}.${productImageExtension(image.type)}`;
      const upload = await access.supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(uploadedPath, image, {
        cacheControl: "3600", contentType: image.type, upsert: false,
      });
      if (upload.error) {
        return { ok: false, message: "No fue posible subir la imagen. Verifica que la migración de Storage esté aplicada." };
      }
    }

    const values: Record<string, unknown> = { ...parsed.data };
    if (uploadedPath) values.imagen_path = uploadedPath;
    else if (removeImage) values.imagen_path = null;
    else if (!id) values.imagen_path = null;

    const result = id
      ? await access.supabase.from("productos").update(values).eq("id", id).select("id,imagen_path").single()
      : await access.supabase.from("productos").insert(values).select("id,imagen_path").single();

    if (result.error || !result.data) {
      if (uploadedPath) await removeStoredImage(access, uploadedPath);
      const pendingMigration = result.error?.code === "42703" || result.error?.code === "PGRST204";
      return { ok: false, message: pendingMigration
        ? "El módulo requiere aplicar primero las migraciones de Productos V1."
        : "No fue posible guardar el producto. Revisa los datos y tus permisos." };
    }

    let cleanupWarning = false;
    if (currentImage && currentImage !== result.data.imagen_path && (uploadedPath || removeImage)) {
      const cleanup = await removeStoredImage(access, currentImage);
      cleanupWarning = Boolean(cleanup.error);
    }

    revalidatePath("/productos");
    return {
      ok: true,
      id: result.data.id,
      message: cleanupWarning
        ? "Producto guardado. La imagen anterior quedó pendiente de limpieza en Storage."
        : id ? "Producto actualizado correctamente." : "Producto creado correctamente.",
    };
  } catch {
    return { ok: false, message: "No fue posible completar la operación. Comprueba tu conexión e inténtalo de nuevo." };
  }
}

export async function setProductActive(id: string, active: boolean): Promise<SaveProductResult> {
  try {
    const access = await getProductAccess();
    if (!access || !canManageProducts(access.role)) {
      return { ok: false, message: "No tienes permiso para administrar productos." };
    }
    if (!productIdSchema.safeParse(id).success || typeof active !== "boolean") {
      return { ok: false, message: "El cambio solicitado no es válido." };
    }
    const { data, error } = await access.supabase.from("productos")
      .update({ activo: active }).eq("id", id).select("id").single();
    if (error || !data) return { ok: false, message: "No fue posible cambiar el estado del producto." };
    revalidatePath("/productos");
    return { ok: true, id: data.id, message: active ? "Producto activado." : "Producto inactivado." };
  } catch {
    return { ok: false, message: "No fue posible cambiar el estado del producto." };
  }
}
