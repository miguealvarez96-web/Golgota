"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";

import Brand from "@/components/layout/brand";
import { createClient } from "@/lib/supabase/client";
import { internalEmail, usernameSchema } from "@/lib/usuarios-internos/model";

const loginSchema = z.object({
  identity: z.string().trim().min(1, "Ingresa tu correo o usuario.").max(255),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
}).superRefine((value, context) => {
  const valid = value.identity.includes("@")
    ? z.string().email().safeParse(value.identity).success
    : usernameSchema.safeParse(value.identity).success;
  if (!valid) context.addIssue({ code: "custom", path: ["identity"], message: "Ingresa un correo o usuario válido." });
});

export default function LoginPage() {
  const supabase = createClient();

  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "callback") {
      setError("El enlace no es válido o ya venció. Solicita uno nuevo.");
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setMessage(null);

    const validation = loginSchema.safeParse({
      identity,
      password,
    });

    if (!validation.success) {
      setError(validation.error.issues[0].message);
      return;
    }

    setLoading(true);
    let internalSessionStarted = false;

    try {
      const internalUsername = validation.data.identity.includes("@")
        ? null
        : usernameSchema.parse(validation.data.identity);
      const email = internalUsername
        ? internalEmail(internalUsername)
        : validation.data.identity.toLowerCase();

      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password: validation.data.password,
      });

      if (loginError) {
        setError(loginError.code === "invalid_credentials"
          ? "Correo, usuario o contraseña incorrectos."
          : "No fue posible iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.");
        return;
      }

      if (!data.session || !data.user) {
        setError("No fue posible confirmar la sesión. Inténtalo de nuevo.");
        return;
      }

      if (internalUsername) {
        internalSessionStarted = true;
        const { data: profile, error: profileError } = await supabase
          .from("usuarios")
          .select("login_username,rol,activo")
          .eq("id", data.user.id)
          .single();
        const validInternalProfile = !profileError
          && profile?.activo === true
          && profile.login_username === internalUsername
          && (profile.rol === "owner" || profile.rol === "staff");

        if (!validInternalProfile) {
          await supabase.auth.signOut();
          setError("Correo, usuario o contraseña incorrectos.");
          return;
        }
      }

      // El SDK ya persistió las cookies. Una navegación completa permite que
      // middleware y layout lean la nueva sesión sin reutilizar el router cache.
      window.location.replace("/");
    } catch {
      if (internalSessionStarted) {
        try {
          await supabase.auth.signOut();
        } catch {
          // No exponer detalles del fallo de red ni dejar continuar al portal.
        }
      }
      setError("No fue posible iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordRecovery() {
    setError(null);
    setMessage(null);

    const emailValidation = z
      .string()
      .email("Ingresa primero un correo electrónico válido.")
      .safeParse(identity);

    if (!emailValidation.success) {
      setError(emailValidation.error.issues[0].message);
      return;
    }

    setRecoveryLoading(true);
    try {
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(
        emailValidation.data,
        { redirectTo: `${window.location.origin}/auth/callback` }
      );
      if (recoveryError) {
        setError("No fue posible enviar el correo de recuperación.");
        return;
      }
      setMessage("Revisa tu correo. Te enviamos un enlace para crear una nueva contraseña.");
    } catch {
      setError("No fue posible enviar el correo de recuperación. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-brand-surface text-brand-text lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="relative flex flex-col justify-between overflow-hidden border-b border-brand-border bg-brand-bg px-6 py-8 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-12 lg:py-12 xl:px-16">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-52 h-[31rem] w-[31rem] rounded-full border-[3rem] border-brand-copper/[0.06] lg:-right-44 lg:top-1/4 lg:h-[42rem] lg:w-[42rem] lg:border-[5rem]" />
        <Brand />
        <div className="relative mt-10 max-w-xl lg:my-auto">
          <div className="mb-5 h-1 w-12 rounded-full bg-brand-copper" />
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-5xl lg:leading-[1.1]">
            Tu comunidad, en un solo lugar.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-brand-secondary lg:mt-5 lg:text-base">
            Gestiona Gólgota CF con claridad, desde cada cliente hasta el resumen de tu operación.
          </p>
        </div>
        <p className="relative mt-10 hidden text-xs font-medium uppercase tracking-[0.18em] text-brand-secondary lg:block">Plataforma Gólgota CF</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10 lg:min-h-screen lg:py-16">
        <div className="w-full max-w-[430px]">
          <p className="eyebrow">Bienvenido</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Iniciar sesión</h2>
          <p className="mt-3 text-sm text-brand-secondary">Ingresa con tu cuenta para acceder al portal.</p>

        <form onSubmit={handleSubmit} className="mt-9 space-y-5">
          <div>
            <label
              htmlFor="identity"
              className="field-label"
            >
              Correo o usuario
            </label>

            <input
              id="identity"
              type="text"
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              autoComplete="username"
              placeholder="correo@ejemplo.com o usuario"
              required
              className="field min-h-12 px-4"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="field-label"
            >
              Contraseña
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
              className="field min-h-12 px-4"
            />
          </div>

          <div className="text-right">
            {identity && !identity.includes("@") ? <p className="text-sm text-brand-secondary">Si olvidaste tu contraseña, solicita al administrador que la restablezca.</p> : <button
              type="button"
              onClick={handlePasswordRecovery}
              disabled={recoveryLoading}
              className="text-sm font-medium text-brand-text underline decoration-brand-copper/50 underline-offset-4 transition hover:text-brand-copper disabled:opacity-60"
            >
              {recoveryLoading
                ? "Enviando..."
                : "¿Olvidaste tu contraseña?"}
            </button>}
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary min-h-12 w-full"
          >
            {loading
              ? "Iniciando sesión..."
              : "Iniciar sesión"}
          </button>
          <Link href="/registro" className="btn-secondary min-h-12 w-full">Crear cuenta de alumno</Link>
        </form>
        <p className="mt-6 text-center text-xs leading-5 text-brand-secondary">Al usar la plataforma puedes consultar cómo tratamos los datos en el <a href="/privacidad" className="font-medium text-brand-text underline decoration-brand-copper/60 underline-offset-4">aviso de privacidad</a>.</p>
        </div>
      </section>
    </main>
  );
}
