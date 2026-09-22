"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local",
      });

      if (signOutError) throw signOutError;

      window.location.replace("/login");
    } catch {
      setError("No fue posible cerrar sesión. Inténtalo de nuevo.");
      setIsLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoading}
        aria-busy={isLoading}
        className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-50"
      >
        {isLoading ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
