"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manageMembershipLifecycle } from "@/app/(app)/membresias/actions";

export default function MembershipLifecycleActions({ id, cancelled }: { id: string; cancelled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function run() {
    const action = cancelled ? "RESTAURAR" : "ELIMINAR";
    const prompt = cancelled
      ? "¿Restaurar esta membresía? Se validará que no genere solapamientos."
      : "¿Está seguro de eliminar este registro? Si existen pagos o historial, la membresía será cancelada y se conservarán sus datos.";
    if (!window.confirm(prompt)) return;
    setMessage(""); setError("");
    startTransition(async () => {
      const result = await manageMembershipLifecycle(id, action);
      if (result.ok) { setMessage(result.message); router.refresh(); } else setError(result.message);
    });
  }
  return <div className="mt-5">
    <button type="button" className={cancelled ? "btn-secondary" : "btn-secondary text-red-700"} disabled={pending} onClick={run}>
      {pending ? "Procesando…" : cancelled ? "Restaurar membresía" : "Eliminar / Cancelar membresía"}
    </button>
    {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </div>;
}
