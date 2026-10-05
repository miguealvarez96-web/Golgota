"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { saveWod } from "@/app/(app)/wod/actions";
import PortalIcon from "@/components/layout/portal-icon";
import { displayDate } from "@/lib/clientes/model";
import type { WodRow } from "@/lib/coaches/model";

export default function WodManager({ wods, canManage, today }: {
  wods: WodRow[];
  canManage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<WodRow | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      fecha: String(data.get("fecha") ?? ""),
      titulo: String(data.get("titulo") ?? ""),
      contenido: String(data.get("contenido") ?? ""),
      publicado: data.get("publicado") === "on",
    };
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await saveWod(editing?.id ?? null, input);
      if (result.ok) {
        setNotice(result.message);
        setEditing(undefined);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return <main className="portal-page">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="eyebrow">Entrenamiento del día</p>
        <h1 className="page-title mt-2">WOD</h1>
        <p className="mt-2 text-sm text-brand-secondary">{canManage ? "Prepara y publica la programación diaria." : "Consulta el entrenamiento publicado para hoy."}</p>
      </div>
      {canManage && <button type="button" className="btn-primary" onClick={() => { setEditing(null); setError(""); }}>
        <PortalIcon name="plus" />Nuevo WOD
      </button>}
    </div>

    {notice && <p role="status" className="mt-5 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">{notice}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {editing !== undefined && <form key={editing?.id ?? "new"} onSubmit={submit} className="panel mt-7 grid gap-5 p-5 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div><label htmlFor="wod-date" className="field-label">Fecha *</label><input id="wod-date" name="fecha" type="date" className="field" required defaultValue={editing?.fecha ?? today} /></div>
        <div><label htmlFor="wod-title" className="field-label">Título *</label><input id="wod-title" name="titulo" className="field" required maxLength={160} defaultValue={editing?.titulo ?? ""} /></div>
      </div>
      <div><label htmlFor="wod-content" className="field-label">Descripción / contenido *</label><textarea id="wod-content" name="contenido" className="field min-h-44 resize-y" required maxLength={10000} defaultValue={editing?.contenido ?? ""} /></div>
      <label className="flex items-center gap-3 text-sm font-medium"><input name="publicado" type="checkbox" className="h-4 w-4 accent-brand-copper" defaultChecked={editing?.publicado ?? false} />Publicado</label>
      <div className="flex flex-wrap justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setEditing(undefined)}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar WOD"}</button></div>
    </form>}

    <div className="mt-7 grid gap-5">
      {!wods.length ? <div className="panel p-10 text-center"><h2 className="font-semibold">{canManage ? "No hay WOD registrados" : "Todavía no hay WOD publicado para hoy"}</h2><p className="mt-2 text-sm text-brand-secondary">{canManage ? "Crea la primera programación del día." : "Vuelve a consultar más tarde."}</p></div>
        : wods.map((wod) => <article key={wod.id} className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-brand-copper">{displayDate(wod.fecha)}</p><h2 className="mt-1 text-xl font-semibold">{wod.titulo}</h2></div>{canManage && <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${wod.publicado ? "border-brand-copper/50 bg-brand-copper/10" : "border-brand-border text-brand-secondary"}`}>{wod.publicado ? "PUBLICADO" : "BORRADOR"}</span>}</div>
          <p className="mt-5 whitespace-pre-wrap border-t border-brand-border pt-5 text-sm leading-7 text-brand-secondary">{wod.contenido}</p>
          {canManage && <div className="mt-5 border-t border-brand-border pt-4"><button type="button" className="btn-secondary" onClick={() => { setEditing(wod); setError(""); }}>Editar</button></div>}
        </article>)}
    </div>
  </main>;
}

