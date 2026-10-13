"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { saveWod } from "@/app/(app)/wod/actions";
import PortalIcon from "@/components/layout/portal-icon";
import { displayDate } from "@/lib/clientes/model";
import type { WodRow } from "@/lib/coaches/model";
import type { CoachSportRecord, CoachSportResult } from "@/lib/deportivo/data";
import { exerciseLabels, formatWodTime } from "@/lib/deportivo/model";

export default function WodManager({ wods, canManage, today, sportOverview }: {
  wods: WodRow[];
  canManage: boolean;
  today: string;
  sportOverview: { resultados: CoachSportResult[]; records: CoachSportRecord[] };
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
      descripcion: String(data.get("descripcion") ?? ""),
      horario_grupo: String(data.get("horario_grupo") ?? ""),
      youtube_url: String(data.get("youtube_url") ?? ""),
      notas: String(data.get("notas") ?? ""),
      benchmark_ref: String(data.get("benchmark_ref") ?? ""),
      permite_resultados: data.get("permite_resultados") === "on",
      limite_tiempo_minutos: data.get("limite_tiempo_minutos") ? Number(data.get("limite_tiempo_minutos")) : null,
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
      <div><label htmlFor="wod-content" className="field-label">Descripción *</label><textarea id="wod-content" name="descripcion" className="field min-h-44 resize-y" required maxLength={10000} defaultValue={editing?.contenido ?? ""} /></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor="wod-group" className="field-label">Horario o grupo</label><input id="wod-group" name="horario_grupo" className="field" maxLength={160} placeholder="06:00, principiantes…" defaultValue={editing?.horario_grupo ?? ""} /></div>
        <div><label htmlFor="wod-video" className="field-label">Video</label><input id="wod-video" name="youtube_url" type="url" className="field" placeholder="https://youtube.com/…" defaultValue={editing?.youtube_url ?? ""} /><p className="mt-1 text-xs text-brand-secondary">Enlace web; se recomienda YouTube o youtu.be.</p></div>
      </div>
      <div><label htmlFor="wod-notes" className="field-label">Notas</label><textarea id="wod-notes" name="notas" className="field min-h-24 resize-y" maxLength={3000} defaultValue={editing?.notas ?? ""} /></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor="wod-benchmark" className="field-label">Referencia de benchmark</label><input id="wod-benchmark" name="benchmark_ref" className="field" maxLength={80} placeholder="FRAN, HELEN…" defaultValue={editing?.benchmark_ref ?? ""} /><p className="mt-1 text-xs text-brand-secondary">Usa la misma referencia solo para repeticiones equivalentes.</p></div>
        <div><label htmlFor="wod-limit" className="field-label">Límite de tiempo (minutos)</label><input id="wod-limit" name="limite_tiempo_minutos" type="number" min="1" max="1440" className="field" defaultValue={editing?.limite_tiempo_minutos ?? ""} /></div>
      </div>
      <label className="flex items-center gap-3 text-sm font-medium"><input name="permite_resultados" type="checkbox" className="h-4 w-4 accent-brand-copper" defaultChecked={editing?.permite_resultados ?? false} />Permite registrar resultados por tiempo</label>
      <label className="flex items-center gap-3 text-sm font-medium"><input name="publicado" type="checkbox" className="h-4 w-4 accent-brand-copper" defaultChecked={editing?.publicado ?? false} />Publicado</label>
      <div className="flex flex-wrap justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setEditing(undefined)}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar WOD"}</button></div>
    </form>}

    <div className="mt-7 grid gap-5">
      {!wods.length ? <div className="panel p-10 text-center"><h2 className="font-semibold">{canManage ? "No hay WOD registrados" : "Todavía no hay WOD publicado para hoy"}</h2><p className="mt-2 text-sm text-brand-secondary">{canManage ? "Crea la primera programación del día." : "Vuelve a consultar más tarde."}</p></div>
        : wods.map((wod) => <article key={wod.id} className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-brand-copper">{displayDate(wod.fecha)}</p><h2 className="mt-1 text-xl font-semibold">{wod.titulo}</h2></div>{canManage && <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${wod.publicado ? "border-brand-copper/50 bg-brand-copper/10" : "border-brand-border text-brand-secondary"}`}>{wod.publicado ? "PUBLICADO" : "BORRADOR"}</span>}</div>
          {wod.horario_grupo && <p className="mt-3 text-sm font-medium text-brand-text">{wod.horario_grupo}</p>}
          <p className="mt-5 whitespace-pre-wrap border-t border-brand-border pt-5 text-sm leading-7 text-brand-secondary">{wod.contenido}</p>
          {wod.notas && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-brand-bg p-4 text-sm text-brand-secondary"><span className="font-medium text-brand-text">Notas:</span> {wod.notas}</p>}
          {wod.youtube_url && <a className="mt-4 inline-flex text-sm font-medium text-brand-copper underline underline-offset-4" href={wod.youtube_url} target="_blank" rel="noreferrer">Ver video del WOD</a>}
          {wod.permite_resultados && <p className="mt-4 text-sm font-medium text-brand-copper">Competitivo por tiempo{wod.limite_tiempo_minutos ? ` · Límite ${wod.limite_tiempo_minutos} min` : ""}{wod.benchmark_ref ? ` · ${wod.benchmark_ref}` : ""}</p>}
          {canManage && <div className="mt-5 border-t border-brand-border pt-4"><button type="button" className="btn-secondary" onClick={() => { setEditing(wod); setError(""); }}>Editar</button></div>}
        </article>)}
    </div>

    <div className="mt-7 grid gap-5 xl:grid-cols-2">
      <details open className="panel p-5 sm:p-6"><summary className="cursor-pointer text-lg font-semibold">Resultados y ranking WOD</summary>
        {sportOverview.resultados.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Posición</th><th className="p-3">Alumno</th><th className="p-3">WOD</th><th className="p-3">Tiempo</th></tr></thead><tbody className="divide-y divide-brand-border">{sportOverview.resultados.map((row) => <tr key={`${row.wod_id}-${row.nombre_visible}`}><td className="p-3 font-semibold text-brand-copper">{row.posicion}</td><td className="p-3">{row.nombre_visible}</td><td className="p-3">{row.wod}</td><td className="p-3 tabular-nums">{formatWodTime(row.tiempo_segundos)}</td></tr>)}</tbody></table></div>
          : <p className="mt-4 text-sm text-brand-secondary">No hay resultados registrados.</p>}
      </details>
      <details className="panel p-5 sm:p-6"><summary className="cursor-pointer text-lg font-semibold">Récords deportivos de alumnos</summary>
        <p className="mt-2 text-xs text-brand-secondary">Vista deportiva segura: no incluye peso corporal, estatura, IMC ni datos de contacto.</p>
        {sportOverview.records.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Alumno</th><th className="p-3">Ejercicio</th><th className="p-3">Marca</th><th className="p-3">Fecha</th></tr></thead><tbody className="divide-y divide-brand-border">{sportOverview.records.map((row, index) => <tr key={`${row.usuario_id}-${row.fecha}-${index}`}><td className="p-3">{row.nombre_visible}</td><td className="p-3">{row.ejercicio === "OTRO" ? row.nombre_personalizado : exerciseLabels[row.ejercicio]}</td><td className="p-3">{row.unidad === "TIEMPO" ? formatWodTime(Math.round(row.valor)) : `${row.valor} ${row.unidad}`}</td><td className="p-3">{displayDate(row.fecha)}</td></tr>)}</tbody></table></div>
          : <p className="mt-4 text-sm text-brand-secondary">No hay récords deportivos registrados.</p>}
      </details>
    </div>
  </main>;
}
