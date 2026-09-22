"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/client";

const loginSchema = z.object({
  email: z.string().email("Ingresa un correo electrónico válido."),
  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres."),
});

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setMessage(null);

    const validation = loginSchema.safeParse({
      email,
      password,
    });

    if (!validation.success) {
      setError(validation.error.issues[0].message);
      return;
    }

    setLoading(true);

    const { error: loginError } =
      await supabase.auth.signInWithPassword({
        email: validation.data.email,
        password: validation.data.password,
      });

    if (loginError) {
      setError("Correo o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handlePasswordRecovery() {
    setError(null);
    setMessage(null);

    const emailValidation = z
      .string()
      .email("Ingresa primero un correo electrónico válido.")
      .safeParse(email);

    if (!emailValidation.success) {
      setError(emailValidation.error.issues[0].message);
      return;
    }

    setRecoveryLoading(true);

    const { error: recoveryError } =
      await supabase.auth.resetPasswordForEmail(
        emailValidation.data,
        {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      );

    if (recoveryError) {
      setError("No fue posible enviar el correo de recuperación.");
      setRecoveryLoading(false);
      return;
    }

    setMessage(
      "Revisa tu correo. Te enviamos un enlace para crear una nueva contraseña."
    );

    setRecoveryLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Gólgota CF
          </h1>

          <p className="mt-2 text-sm text-zinc-400">
            Portal de administración
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-zinc-200"
            >
              Correo electrónico
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="correo@ejemplo.com"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-zinc-200"
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
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-zinc-500"
            />
          </div>

          <div className="text-right">
            <button
              type="button"
              onClick={handlePasswordRecovery}
              disabled={recoveryLoading}
              className="text-sm text-zinc-400 underline transition hover:text-white disabled:opacity-60"
            >
              {recoveryLoading
                ? "Enviando..."
                : "¿Olvidaste tu contraseña?"}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-white px-4 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Iniciando sesión..."
              : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </main>
  );
}