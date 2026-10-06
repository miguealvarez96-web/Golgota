"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getInternalUsersAdminAccess } from "@/lib/usuarios-internos/access";
import {
  createInternalUserSchema,
  internalEmail,
  resetInternalPasswordSchema,
  updateInternalUserSchema,
  type InternalUserResult,
} from "@/lib/usuarios-internos/model";

const genericError = "No fue posible completar la operación. Revisa los datos e inténtalo de nuevo.";

function formBoolean(value: FormDataEntryValue | null) {
  return value === "true" || value === "on";
}

export async function createInternalUser(data: FormData): Promise<InternalUserResult> {
  const parsed = createInternalUserSchema.safeParse({
    nombre: data.get("nombre"),
    username: data.get("username"),
    rol: data.get("rol"),
    password: data.get("password"),
    passwordConfirmation: data.get("passwordConfirmation"),
    activo: formBoolean(data.get("activo")),
  });
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos señalados.", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const access = await getInternalUsersAdminAccess();
    if (!access) return { ok: false, message: "No tienes permiso para administrar usuarios internos." };

    const email = internalEmail(parsed.data.username);
    const existing = await access.supabase.from("usuarios").select("id,login_username,rol,activo")
      .or(`login_username.eq.${parsed.data.username},email.eq.${email}`).maybeSingle();
    if (existing.error) return { ok: false, message: "No fue posible verificar la disponibilidad del usuario." };

    const admin = createAdminClient();
    let userId: string;
    let createdNow = false;

    if (existing.data) {
      if (existing.data.login_username || existing.data.rol !== "alumno" || existing.data.activo) {
        return { ok: false, message: "Ese usuario ya está registrado." };
      }
      const authUser = await admin.auth.admin.getUserById(existing.data.id);
      if (authUser.error || authUser.data.user.user_metadata?.account_type !== "internal") {
        return { ok: false, message: "Ese usuario ya está registrado." };
      }
      const resumed = await admin.auth.admin.updateUserById(existing.data.id, {
        password: parsed.data.password,
        email_confirm: true,
        ban_duration: parsed.data.activo ? "none" : "876000h",
        user_metadata: { nombre: parsed.data.nombre, account_type: "internal" },
      });
      if (resumed.error) return { ok: false, message: genericError };
      userId = existing.data.id;
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password: parsed.data.password,
        email_confirm: true,
        ban_duration: parsed.data.activo ? "none" : "876000h",
        user_metadata: { nombre: parsed.data.nombre, account_type: "internal" },
      });
      if (created.error || !created.data.user) {
        return { ok: false, message: created.error?.message?.toLowerCase().includes("already")
          ? "Ese usuario ya está registrado."
          : genericError };
      }
      userId = created.data.user.id;
      createdNow = true;
    }

    const profile = await access.supabase.from("usuarios").update({
      email,
      nombre: parsed.data.nombre,
      login_username: parsed.data.username,
      rol: parsed.data.rol,
      activo: parsed.data.activo,
    }).eq("id", userId).select("id").single();

    if (profile.error || !profile.data) {
      if (createdNow) await admin.auth.admin.deleteUser(userId);
      return { ok: false, message: createdNow
        ? "No se pudo vincular el perfil. La cuenta Auth creada fue revertida."
        : "No se pudo completar el perfil interno. Puedes reintentar la operación." };
    }

    revalidatePath("/usuarios");
    return { ok: true, message: `Usuario ${parsed.data.username} creado correctamente.` };
  } catch {
    return { ok: false, message: genericError };
  }
}

export async function updateInternalUser(input: unknown): Promise<InternalUserResult> {
  const parsed = updateInternalUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "El cambio solicitado no es válido." };

  try {
    const access = await getInternalUsersAdminAccess();
    if (!access) return { ok: false, message: "No tienes permiso para administrar usuarios internos." };
    if (parsed.data.id === access.userId) return { ok: false, message: "La cuenta administradora no puede modificarse desde este módulo." };

    const current = await access.supabase.from("usuarios")
      .select("id,rol,activo,login_username")
      .eq("id", parsed.data.id).not("login_username", "is", null).single();
    if (current.error || !current.data || !["owner", "staff"].includes(current.data.rol)) {
      return { ok: false, message: "No se encontró una cuenta interna administrable." };
    }

    const admin = createAdminClient();
    if (current.data.activo !== parsed.data.activo) {
      const authUpdate = await admin.auth.admin.updateUserById(parsed.data.id, {
        ban_duration: parsed.data.activo ? "none" : "876000h",
      });
      if (authUpdate.error) return { ok: false, message: "No fue posible cambiar el acceso de la cuenta." };
    }

    const updated = await access.supabase.from("usuarios")
      .update({ rol: parsed.data.rol, activo: parsed.data.activo })
      .eq("id", parsed.data.id).select("id").single();
    if (updated.error || !updated.data) {
      if (current.data.activo !== parsed.data.activo) {
        await admin.auth.admin.updateUserById(parsed.data.id, {
          ban_duration: current.data.activo ? "none" : "876000h",
        });
      }
      return { ok: false, message: genericError };
    }

    revalidatePath("/usuarios");
    return { ok: true, message: "Usuario interno actualizado." };
  } catch {
    return { ok: false, message: genericError };
  }
}

export async function resetInternalPassword(input: unknown): Promise<InternalUserResult> {
  const parsed = resetInternalPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Revisa las contraseñas.", errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const access = await getInternalUsersAdminAccess();
    if (!access) return { ok: false, message: "No tienes permiso para administrar usuarios internos." };
    if (parsed.data.id === access.userId) return { ok: false, message: "La cuenta administradora no puede modificarse desde este módulo." };

    const target = await access.supabase.from("usuarios")
      .select("id,login_username,rol")
      .eq("id", parsed.data.id).not("login_username", "is", null).single();
    if (target.error || !target.data || !["owner", "staff"].includes(target.data.rol)) {
      return { ok: false, message: "No se encontró una cuenta interna administrable." };
    }

    const admin = createAdminClient();
    const result = await admin.auth.admin.updateUserById(parsed.data.id, { password: parsed.data.password });
    if (result.error) return { ok: false, message: "No fue posible restablecer la contraseña." };

    const audit = await admin.from("auditoria_logs").insert({
      usuario_id: access.userId,
      tabla: "usuarios",
      accion: "PASSWORD_RESET",
      registro_id: parsed.data.id,
      datos_anteriores: null,
      datos_nuevos: { evento: "CONTRASENA_RESTABLECIDA", login_username: target.data.login_username },
    });

    if (audit.error) {
      return { ok: false, message: "La contraseña fue restablecida, pero no se pudo registrar la auditoría. Revisa los logs del servidor." };
    }

    return { ok: true, message: "Contraseña restablecida. El usuario ya puede iniciar sesión." };
  } catch {
    return { ok: false, message: genericError };
  }
}
