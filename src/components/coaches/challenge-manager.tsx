"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { manageChallengeLifecycle, saveChallenge, updateCoachChallengeProgress } from "@/app/(app)/desafios/actions";
import { displayDate } from "@/lib/clientes/model";
import type { ManagedChallenge } from "@/lib/deportivo/data";

export default function ChallengeManager({ challenges, canLifecycle, filter }: { challenges: ManagedChallenge[]; canLifecycle: boolean; filter: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ManagedChallenge | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setNotice(""); setError("");
    startTransition(async () => { const result = await action(); if (result.ok) { setNotice(result.message); setEditing(undefined); router.refresh(); } else setError(result.message); });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    run(() => saveChallenge({
      id: editing?.id ?? null, titulo: String(form.get("titulo")), descripcion: String(form.get("descripcion")),
      fecha_inicio: String(form.get("fecha_inicio")), fecha_fin: String(form.get("fecha_fin")),
      objetivo_numero: Number(form.get("objetivo_numero")), unidad: String(form.get("unidad")), estado: String(form.get("estado")),
    }));
  }
  function lifecycle(challenge: ManagedChallenge) {
    const action = challenge.archivado ? "RESTAURAR" : "ELIMINAR";
    const prompt = challenge.archivado ? `¿Restaurar ${challenge.titulo}?` : "¿Está seguro de eliminar este registro? Si existen participantes o progreso, el desafío será archivado.";
    if (!window.confirm(prompt)) return;
    run(() => manageChallengeLifecycle(challenge.id, action));
  }

  return <main className="portal-page"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Gamificación simple</p><h1 className="page-title mt-2">Desafíos</h1><p className="mt-2 text-sm text-brand-secondary">Crea objetivos, consulta participantes y valida su progreso.</p></div><button className="btn-primary" type="button" onClick={() => setEditing(null)}>Nuevo desafío</button></div>
    {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}{error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <form action="/desafios" className="panel mt-5 flex flex-wrap items-end gap-3 p-4"><div><label htmlFor="challenge-filter" className="field-label">Estado</label><select id="challenge-filter" name="filtro" className="field" defaultValue={filter}><option value="activos">Activos</option><option value="cerrados">Cerrados</option><option value="archivados">Archivados</option><option value="todos">Todos</option></select></div><button className="btn-secondary">Filtrar</button></form>
    {editing !== undefined && <form onSubmit={submit} className="panel mt-7 grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
      <div><label className="field-label" htmlFor="challenge-title">Título</label><input id="challenge-title" name="titulo" className="field" maxLength={160} defaultValue={editing?.titulo ?? ""} required /></div>
      <div><label className="field-label" htmlFor="challenge-unit">Unidad del objetivo</label><input id="challenge-unit" name="unidad" className="field" maxLength={80} placeholder="entrenamientos, WOD…" defaultValue={editing?.unidad ?? ""} required /></div>
      <div className="sm:col-span-2"><label className="field-label" htmlFor="challenge-description">Descripción</label><textarea id="challenge-description" name="descripcion" className="field min-h-24" maxLength={3000} defaultValue={editing?.descripcion ?? ""} required /></div>
      <div><label className="field-label" htmlFor="challenge-start">Inicio</label><input id="challenge-start" name="fecha_inicio" type="date" className="field" defaultValue={editing?.fecha_inicio ?? ""} required /></div>
      <div><label className="field-label" htmlFor="challenge-end">Fin</label><input id="challenge-end" name="fecha_fin" type="date" className="field" defaultValue={editing?.fecha_fin ?? ""} required /></div>
      <div><label className="field-label" htmlFor="challenge-goal">Objetivo</label><input id="challenge-goal" name="objetivo_numero" type="number" min="0.01" step="0.01" className="field" defaultValue={editing?.objetivo_numero ?? ""} required /></div>
      <div><label className="field-label" htmlFor="challenge-state">Estado</label><select id="challenge-state" name="estado" className="field" defaultValue={editing?.estado ?? "BORRADOR"}><option>BORRADOR</option><option>ACTIVO</option><option>CERRADO</option></select></div>
      <div className="flex justify-end gap-3 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setEditing(undefined)}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>Guardar desafío</button></div>
    </form>}
    <div className="mt-7 grid gap-5">{challenges.length ? challenges.map((challenge) => <article key={challenge.id} className="panel p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{challenge.titulo}</h2><span className="rounded-full border border-brand-border px-2 py-1 text-xs font-semibold">{challenge.archivado ? "ARCHIVADO" : challenge.estado}</span></div><p className="mt-2 text-sm text-brand-secondary">{challenge.descripcion}</p><p className="mt-2 text-xs text-brand-secondary">{displayDate(challenge.fecha_inicio)} — {displayDate(challenge.fecha_fin)} · Meta {challenge.objetivo_numero} {challenge.unidad}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={challenge.archivado} onClick={() => setEditing(challenge)}>Editar</button>{canLifecycle && <button type="button" className={challenge.archivado ? "btn-secondary" : "btn-secondary text-red-700"} disabled={pending} onClick={() => lifecycle(challenge)}>{challenge.archivado ? "Restaurar" : "Eliminar / Archivar"}</button>}</div></div>
      <details className="mt-5 border-t border-brand-border pt-4"><summary className="cursor-pointer font-medium">Participantes ({challenge.participantes.length})</summary>{challenge.participantes.length ? <div className="mt-3 space-y-3">{challenge.participantes.map((participant) => <form key={participant.usuario_id} className="flex flex-wrap items-end gap-3 rounded-xl bg-brand-bg p-3" onSubmit={(event) => { event.preventDefault(); if (challenge.archivado) return; const form = new FormData(event.currentTarget); run(() => updateCoachChallengeProgress({ desafio_id: challenge.id, usuario_id: participant.usuario_id, progreso: Number(form.get("progreso")) })); }}><div className="min-w-44 flex-1"><p className="font-medium">{participant.nombre_visible}</p><p className="text-xs text-brand-secondary">{participant.progreso} / {challenge.objetivo_numero} · {Math.round(participant.porcentaje)} %{participant.completed_at ? " · COMPLETADO" : ""}</p></div><div><label className="field-label" htmlFor={`progress-${challenge.id}-${participant.usuario_id}`}>Progreso validado</label><input id={`progress-${challenge.id}-${participant.usuario_id}`} name="progreso" type="number" min="0" max={challenge.objetivo_numero} step="0.01" className="field w-36" defaultValue={participant.progreso} disabled={challenge.archivado} /></div><button className="btn-secondary" disabled={pending || challenge.archivado}>Actualizar</button></form>)}</div> : <p className="mt-3 text-sm text-brand-secondary">Sin participantes.</p>}</details>
    </article>) : <div className="panel p-8 text-center text-sm text-brand-secondary">No hay desafíos creados.</div>}</div>
  </main>;
}
