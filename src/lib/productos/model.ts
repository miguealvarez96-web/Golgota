import { z } from "zod";

export const productStates = ["activo", "inactivo"] as const;
export type ProductRole = "admin" | "owner" | "staff";

export const PRODUCT_IMAGE_BUCKET = "productos";
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function canViewProducts(role: string): role is ProductRole {
  return role === "admin" || role === "owner" || role === "staff";
}

export function canManageProducts(role: string) {
  return role === "admin" || role === "owner";
}

export function normalizeProductText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n\f\v]+/g, " ").trim();
}

const optionalText = (maximum: number, message: string) => z.string().max(maximum, message)
  .transform((value) => normalizeProductText(value) || null);

const price = z.string().trim()
  .regex(/^(?:0\.(?:0[1-9]|[1-9][0-9]?)|[1-9][0-9]{0,7}(?:\.[0-9]{1,2})?)$/,
    "Ingresa un precio mayor que cero, con máximo dos decimales.")
  .transform(Number);

const stock = z.string().trim().regex(/^[0-9]+$/, "El stock debe ser un número entero igual o mayor que cero.")
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value <= 2_147_483_647,
    "El stock ingresado está fuera del rango permitido.");

export const productSchema = z.object({
  nombre: z.string().transform(normalizeProductText).pipe(z.string()
    .min(1, "El nombre es obligatorio.").max(255, "Máximo 255 caracteres.")),
  categoria: optionalText(100, "Máximo 100 caracteres."),
  descripcion: z.string().max(2000, "Máximo 2000 caracteres.")
    .transform((value) => value.trim() || null),
  precio: price,
  stock,
  activo: z.boolean(),
}).strict();

export type ProductInput = z.input<typeof productSchema>;
export type ProductValues = z.output<typeof productSchema>;

export type ProductRow = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  precio: number;
  stock: number;
  activo: boolean;
  imagen_path: string | null;
  created_at: string;
  updated_at: string;
  image_url?: string | null;
};

export type SaveProductResult = { ok: true; id: string; message: string } | {
  ok: false;
  message: string;
  errors?: Partial<Record<keyof ProductInput | "imagen", string[]>>;
};

type FormDataReader = Pick<FormData, "get">;

export function productInputFromFormData(data: FormDataReader): ProductInput {
  return {
    nombre: String(data.get("nombre") ?? ""),
    categoria: String(data.get("categoria") ?? ""),
    descripcion: String(data.get("descripcion") ?? ""),
    precio: String(data.get("precio") ?? ""),
    stock: String(data.get("stock") ?? ""),
    activo: data.get("activo") === "on" || data.get("activo") === "true",
  };
}

export type ProductImageLike = {
  name: string;
  size: number;
  type: string;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};

export function productImageMetadataError(file: Pick<ProductImageLike, "name" | "size" | "type"> | null) {
  if (!file || file.size === 0) return null;
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return "La imagen no puede superar 2 MB.";
  if (!PRODUCT_IMAGE_TYPES.includes(file.type as (typeof PRODUCT_IMAGE_TYPES)[number])) {
    return "La imagen debe ser JPG, PNG o WEBP.";
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  const extensions: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
  };
  if (!extension || !extensions[file.type]?.includes(extension)) return "La extensión no coincide con el tipo de imagen.";
  return null;
}

export async function productImageContentError(file: ProductImageLike | null) {
  const metadataError = productImageMetadataError(file);
  if (metadataError || !file || file.size === 0) return metadataError;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12
    && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF"
    && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP";
  if ((file.type === "image/jpeg" && !jpeg) || (file.type === "image/png" && !png)
      || (file.type === "image/webp" && !webp)) {
    return "El contenido del archivo no corresponde a una imagen JPG, PNG o WEBP válida.";
  }
  return null;
}

export function productImageExtension(type: string) {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
}

export function productSearchFilter(query: string) {
  const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  return ["nombre", "categoria", "descripcion"].map((field) => `${field}.ilike.${pattern}`).join(",");
}

export function productMoneyLabel(value: number) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value);
}
