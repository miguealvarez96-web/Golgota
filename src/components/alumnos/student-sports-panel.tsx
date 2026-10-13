"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  joinChallenge,
  savePersonalRecord,
  savePhysicalProgress,
  saveWodResult,
  updateStudentChallengeProgress,
} from "@/app/(student)/portal/sports-actions";
import { displayDate } from "@/lib/clientes/model";
import {
  bestComparableRecord,
  exerciseLabels,
  formatWodTime,
  sportExercises,
  type PersonalRecord,
  type SportUnit,
  type StudentSportData,
} from "@/lib/deportivo/model";

export default function StudentSportsPanel({ data, today }: { data: StudentSportData; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recordUnit, setRecordUnit] = useState<SportUnit>("KG");
  const [recordExercise, setRecordExercise] = useState("BACK_SQUAT");
  const progress = data.progreso;
  const current = progress[0] ?? null;
  const previous = progress[1] ?? null;
  const difference = current && previous ? Number((current.peso_kg - previous.peso_kg).toFixed(2)) : null;
  const chart = [...progress].reverse().map((item) => ({ fecha: item.fecha.slice(5), peso: item.peso_kg }));

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setNotice(""); setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) { setNotice(result.message); router.refresh(); } else setError(result.message);
    });
  }

  function submitProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(() => savePhysicalProgress({
      fecha: String(form.get("fecha")), peso_kg: Number(form.get("peso_kg")), estatura_m: Number(form.get("estatura_m")),
    }));
  }

  function submitRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(() => savePersonalRecord({
      ejercicio: String(form.get("ejercicio")),
      nombre_personalizado: recordExercise === "OTRO" ? String(form.get("nombre_personalizado") ?? "").trim() || null : null,
      valor: Number(form.get("valor")), unidad: String(form.get("unidad")), fecha: String(form.get("fecha")),
      observacion: String(form.get("observacion") ?? ""),
    }));
  }

  function submitTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (data.wod_actual) run(() => saveWodResult({ wod_id: data.wod_actual!.id, tiempo: String(form.get("tiempo")) }));
  }

  return <section className="mt-7 space-y-5" aria-labelledby="sports-title">
    <div><p className="eyebrow">Rendimiento deportivo</p><h2 id="sports-title" className="mt-2 text-2xl font-semibold">Mi actividad</h2>
      <p className="mt-2 text-sm text-brand-secondary">Registra tus avances deportivos sin recomendaciones médicas ni nutricionales.</p></div>
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {data.wod_actual?.permite_resultados && <details open className="panel p-5 sm:p-7">
      <summary className="cursor-pointer text-lg font-semibold">Mi tiempo y ranking</summary>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
        <form onSubmit={submitTime} className="rounded-xl bg-brand-bg p-4">
          <h3 className="font-semibold">Registrar mi tiempo</h3><p className="mt-1 text-sm text-brand-secondary">{data.wod_actual.titulo}</p>
          <label htmlFor="wod-time" className="field-label mt-4">Tiempo (MM:SS o HH:MM:SS)</label>
          <input id="wod-time" name="tiempo" className="field" inputMode="numeric" pattern="(?:[0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2}" placeholder="08:42" required />
          {data.wod_actual.limite_tiempo_minutos && <p className="mt-2 text-xs text-brand-secondary">Límite: {data.wod_actual.limite_tiempo_minutos} minutos.</p>}
          {data.wod_actual.mi_tiempo_segundos && <p className="mt-3 text-sm">Tu tiempo: <strong>{formatWodTime(data.wod_actual.mi_tiempo_segundos)}</strong>{data.wod_actual.mi_posicion ? ` · Posición ${data.wod_actual.mi_posicion}` : ""}</p>}
          <button className="btn-primary mt-4" type="submit" disabled={pending}>{data.wod_actual.mi_tiempo_segundos ? "Corregir mi tiempo" : "Registrar mi tiempo"}</button>
        </form>
        <div><h3 className="font-semibold">Ranking del WOD</h3>{data.wod_actual.ranking.length
          ? <ol className="mt-3 divide-y divide-brand-border">{data.wod_actual.ranking.map((row) => <li key={`${row.posicion}-${row.nombre_visible}`} className="flex justify-between gap-4 py-3 text-sm"><span><strong className="mr-3 text-brand-copper">{row.posicion}.</strong>{row.nombre_visible}</span><span className="font-semibold tabular-nums">{formatWodTime(row.tiempo_segundos)}</span></li>)}</ol>
          : <p className="mt-3 text-sm text-brand-secondary">Todavía no hay tiempos registrados.</p>}</div>
      </div>
    </details>}

    <details open className="panel p-5 sm:p-7">
      <summary className="cursor-pointer text-lg font-semibold">Mi progreso</summary>
      <p className="mt-3 text-sm text-brand-secondary">El Índice de Masa Corporal (IMC) es orientativo y no constituye diagnóstico médico.</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Peso actual" value={current ? `${current.peso_kg.toFixed(2)} kg` : "Sin registros"} />
        <Metric label="Peso anterior" value={previous ? `${previous.peso_kg.toFixed(2)} kg` : "Sin registro anterior"} />
        <Metric label="Diferencia" value={difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference.toFixed(2)} kg`} />
        <Metric label="Estatura" value={current ? `${current.estatura_m.toFixed(2)} m` : "—"} />
        <Metric label="Índice de Masa Corporal (IMC) orientativo" value={current ? current.imc.toFixed(2) : "—"} />
      </dl>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitProgress} className="grid content-start gap-4 rounded-xl bg-brand-bg p-4 sm:grid-cols-3 lg:grid-cols-1">
          <div><label className="field-label" htmlFor="progress-date">Fecha</label><input id="progress-date" name="fecha" type="date" className="field" max={today} defaultValue={today} required /></div>
          <div><label className="field-label" htmlFor="progress-weight">Peso (kg)</label><input id="progress-weight" name="peso_kg" type="number" className="field" min="20" max="350" step="0.01" required /></div>
          <div><label className="field-label" htmlFor="progress-height">Estatura (m)</label><input id="progress-height" name="estatura_m" type="number" className="field" min="0.8" max="2.5" step="0.01" required /></div>
          <button className="btn-primary sm:col-span-3 lg:col-span-1" type="submit" disabled={pending}>Guardar registro</button>
        </form>
        <div className="h-64 min-w-0" aria-label="Gráfica de evolución del peso">{chart.length
          ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="fecha" /><YAxis domain={["dataMin - 2", "dataMax + 2"]} /><Tooltip /><Line type="monotone" dataKey="peso" name="Peso kg" stroke="#A7674E" strokeWidth={2} /></LineChart></ResponsiveContainer>
          : <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-brand-border text-sm text-brand-secondary">Registra tu primer peso para ver la evolución.</div>}</div>
      </div>
      {progress.length > 0 && <div className="mt-6 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Fecha</th><th className="p-3">Peso</th><th className="p-3">Estatura</th><th className="p-3">IMC orientativo</th></tr></thead><tbody className="divide-y divide-brand-border">{progress.map((item) => <tr key={item.id}><td className="p-3">{displayDate(item.fecha)}</td><td className="p-3">{item.peso_kg.toFixed(2)} kg</td><td className="p-3">{item.estatura_m.toFixed(2)} m</td><td className="p-3">{item.imc.toFixed(2)}</td></tr>)}</tbody></table></div>}
    </details>

    <details className="panel p-5 sm:p-7">
      <summary className="cursor-pointer text-lg font-semibold">Mis récords personales</summary>
      <form onSubmit={submitRecord} className="mt-5 grid gap-4 rounded-xl bg-brand-bg p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className="field-label" htmlFor="record-exercise">Ejercicio</label><select id="record-exercise" name="ejercicio" className="field" value={recordExercise} onChange={(event) => setRecordExercise(event.target.value)}>{sportExercises.map((exercise) => <option key={exercise} value={exercise}>{exerciseLabels[exercise]}</option>)}</select></div>
        {recordExercise === "OTRO" && <div><label className="field-label" htmlFor="record-custom">Nombre del ejercicio</label><input id="record-custom" name="nombre_personalizado" className="field" maxLength={100} required /></div>}
        <div><label className="field-label" htmlFor="record-unit">Unidad</label><select id="record-unit" name="unidad" className="field" value={recordUnit} onChange={(event) => setRecordUnit(event.target.value as SportUnit)}><option value="KG">KG</option><option value="REPETICIONES">REPETICIONES</option><option value="TIEMPO">TIEMPO</option></select></div>
        <div><label className="field-label" htmlFor="record-value">Valor {recordUnit === "TIEMPO" ? "(segundos)" : ""}</label><input id="record-value" name="valor" type="number" className="field" min="0.01" step="0.01" required /></div>
        <div><label className="field-label" htmlFor="record-date">Fecha</label><input id="record-date" name="fecha" type="date" className="field" max={today} defaultValue={today} required /></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="field-label" htmlFor="record-note">Observación opcional</label><input id="record-note" name="observacion" className="field" maxLength={500} /></div>
        <button className="btn-primary sm:col-span-2 lg:col-span-3" type="submit" disabled={pending}>Guardar récord</button>
      </form>
      <RecordsHistory records={data.records} />
    </details>

    <details className="panel p-5 sm:p-7">
      <summary className="cursor-pointer text-lg font-semibold">Mis WOD</summary>
      {data.historial_wod.length ? <div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Fecha</th><th className="p-3">WOD</th><th className="p-3">Tiempo</th><th className="p-3">Posición</th><th className="p-3">Mejor tiempo</th></tr></thead><tbody className="divide-y divide-brand-border">{data.historial_wod.map((item) => <tr key={item.wod_id}><td className="p-3">{displayDate(item.fecha)}</td><td className="p-3 font-medium">{item.titulo}{item.nuevo_pr && <span className="ml-2 rounded-full bg-brand-copper/10 px-2 py-1 text-xs font-semibold text-brand-copper">NUEVO PR</span>}</td><td className="p-3">{formatWodTime(item.tiempo_segundos)}</td><td className="p-3">{item.posicion}</td><td className="p-3">{formatWodTime(item.mejor_tiempo_segundos)}</td></tr>)}</tbody></table></div>
        : <p className="mt-4 text-sm text-brand-secondary">Todavía no has registrado resultados WOD.</p>}
    </details>

    <details className="panel p-5 sm:p-7">
      <summary className="cursor-pointer text-lg font-semibold">Desafíos</summary>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{data.desafios.length ? data.desafios.map((challenge) => <article key={challenge.id} className="rounded-xl border border-brand-border p-4">
        <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{challenge.titulo}</h3>{challenge.completed_at && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">COMPLETADO</span>}</div>
        <p className="mt-2 text-sm text-brand-secondary">{challenge.descripcion}</p><p className="mt-3 text-sm font-semibold">{challenge.progreso} / {challenge.objetivo_numero} {challenge.unidad} · {Math.round(challenge.porcentaje)} %</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-bg"><div className="h-full bg-brand-copper" style={{ width: `${challenge.porcentaje}%` }} /></div>
        {!challenge.unido ? <button className="btn-secondary mt-4" type="button" disabled={pending} onClick={() => run(() => joinChallenge(challenge.id))}>Unirme</button>
          : !challenge.completed_at && <button className="btn-secondary mt-4" type="button" disabled={pending} onClick={() => run(() => updateStudentChallengeProgress({ desafio_id: challenge.id, progreso: Math.min(challenge.objetivo_numero, challenge.progreso + 1) }))}>Marcar +1</button>}
      </article>) : <p className="text-sm text-brand-secondary">No hay desafíos activos en este momento.</p>}</div>
    </details>
  </section>;
}

function RecordsHistory({ records }: { records: PersonalRecord[] }) {
  if (!records.length) return <p className="mt-5 text-sm text-brand-secondary">Todavía no tienes récords registrados.</p>;
  const latestByExercise = new Map<string, PersonalRecord>();
  for (const record of records) {
    const key = `${record.ejercicio}:${record.nombre_personalizado ?? ""}:${record.unidad}`;
    if (!latestByExercise.has(key)) latestByExercise.set(key, record);
  }
  const displayValue = (record: PersonalRecord, value: number) => record.unidad === "TIEMPO"
    ? formatWodTime(Math.round(value)) : `${value} ${record.unidad === "KG" ? "kg" : "rep."}`;
  return <><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from(latestByExercise.values()).map((latest) => {
    const best = bestComparableRecord(records, latest);
    return <article key={`${latest.ejercicio}-${latest.nombre_personalizado}-${latest.unidad}`} className="rounded-xl border border-brand-border p-4"><h3 className="font-semibold">{latest.ejercicio === "OTRO" ? latest.nombre_personalizado : exerciseLabels[latest.ejercicio]}</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><Metric label="Último registro" value={displayValue(latest, latest.valor)} /><Metric label="Mejor registro" value={best ? displayValue(latest, best.valor) : "—"} /></dl></article>;
  })}</div><h3 className="mt-6 font-semibold">Historial</h3><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-brand-border"><th className="p-3">Fecha</th><th className="p-3">Ejercicio</th><th className="p-3">Registro</th><th className="p-3">Mejor comparable</th><th className="p-3">Observación</th></tr></thead><tbody className="divide-y divide-brand-border">{records.map((record) => {
    const best = bestComparableRecord(records, record);
    return <tr key={record.id}><td className="p-3">{displayDate(record.fecha)}</td><td className="p-3 font-medium">{record.ejercicio === "OTRO" ? record.nombre_personalizado : exerciseLabels[record.ejercicio]}</td><td className="p-3">{displayValue(record, record.valor)}</td><td className="p-3">{best ? displayValue(record, best.valor) : "—"}</td><td className="p-3 text-brand-secondary">{record.observacion ?? "—"}</td></tr>;
  })}</tbody></table></div></>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-brand-bg p-4"><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-2 font-semibold">{value}</dd></div>;
}
