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
    <div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoading}
        aria-busy={isLoading}
        className="btn-secondary"
      >
        {isLoading ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
