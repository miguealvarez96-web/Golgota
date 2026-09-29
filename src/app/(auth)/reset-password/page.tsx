"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(
        "No fue posible actualizar la contraseña. Solicita un nuevo enlace."
      );
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();

    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-bg px-4 py-8">
      <div className="panel w-full max-w-md p-7 sm:p-9">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-brand-text">
            Gólgota CF
          </h1>

          <p className="mt-2 text-sm text-brand-secondary">
            Crear nueva contraseña
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="password"
              className="field-label"
            >
              Nueva contraseña
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              className="field min-h-12 px-4"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="field-label"
            >
              Confirmar contraseña
            </label>

            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              className="field min-h-12 px-4"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary min-h-12 w-full"
          >
            {loading ? "Guardando..." : "Guardar contraseña"}
          </button>
        </form>
      </div>
    </main>
  );
}
