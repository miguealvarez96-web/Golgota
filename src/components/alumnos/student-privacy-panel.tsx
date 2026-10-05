"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { acceptPrivacyNotice, createPrivacyRequest } from "@/app/(student)/portal/privacy-actions";
import {
  PRIVACY_NOTICE_VERSION,
  privacyRequestStateLabels,
  privacyRequestTypeLabels,
  privacyRequestTypes,
  type StudentPrivacyData,
} from "@/lib/privacidad/model";

export default function StudentPrivacyPanel({ privacy }: { privacy: StudentPrivacyData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noticeRead, setNoticeRead] = useState(false);
  const [promotions, setPromotions] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const acceptedCurrent = privacy.acceptance?.aviso_version === PRIVACY_NOTICE_VERSION;

  function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setError("");
    startTransition(async () => {
      const result = await acceptPrivacyNotice({
        aviso_version: PRIVACY_NOTICE_VERSION,
        aviso_leido: noticeRead,
        comunicaciones_promocionales: promotions,
      });
      if (result.ok) { setMessage(result.message); router.refresh(); }
      else setError(result.message);
    });
  }

  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setMessage(""); setError("");
    startTransition(async () => {
      const result = await createPrivacyRequest({
        tipo: data.get("tipo"), descripcion: data.get("descripcion"),
      });
      if (result.ok) { setMessage(result.message); form.reset(); router.refresh(); }
      else setError(result.message);
    });
  }

  return <section className="mt-8" aria-labelledby="student-privacy-title">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Control personal</p><h2 id="student-privacy-title" className="mt-2 text-xl font-semibold">Privacidad y mis datos</h2><p className="mt-2 text-sm text-brand-secondary">Consulta el aviso y envía solicitudes para revisión humana.</p></div><a href="/privacidad" className="btn-secondary">Abrir aviso vigente</a></div>
    {!privacy.available ? <div className="panel mt-5 p-5 text-sm text-brand-secondary" role="status">{privacy.error}</div> : <>
      {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="panel p-5 sm:p-7">
          <h3 className="text-lg font-semibold">Evidencia del aviso</h3>
          {privacy.acceptance ? <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><Metric label="Versión reconocida" value={privacy.acceptance.aviso_version} /><Metric label="Fecha y hora" value={dateTime(privacy.acceptance.accepted_at)} /><Metric label="Contexto" value="Portal del alumno" /><Metric label="Comunicaciones promocionales" value={privacy.acceptance.comunicaciones_promocionales ? "Aceptadas opcionalmente" : "No aceptadas"} /></dl>
            : <p className="mt-4 text-sm text-brand-secondary">Todavía no registras el reconocimiento de una versión del aviso.</p>}
          {!acceptedCurrent && <form className="mt-6 border-t border-brand-border pt-5" onSubmit={accept}>
            <p className="text-sm font-medium">Aviso vigente: {PRIVACY_NOTICE_VERSION}</p>
            <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-copper" checked={noticeRead} onChange={(event) => setNoticeRead(event.target.checked)} required /><span>Confirmo que abrí y leí el aviso vigente. Este reconocimiento no autoriza indiscriminadamente todos los tratamientos.</span></label>
            <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-copper" checked={promotions} onChange={(event) => setPromotions(event.target.checked)} /><span>Acepto opcionalmente recibir comunicaciones promocionales cuando Gólgota defina un canal y alcance. Esta casilla no está premarcada.</span></label>
            <button type="submit" className="btn-primary mt-5" disabled={pending || !noticeRead}>{pending ? "Registrando…" : "Registrar aceptación"}</button>
          </form>}
        </article>

        <article className="panel p-5 sm:p-7">
          <h3 className="text-lg font-semibold">Nueva solicitud</h3>
          <p className="mt-2 text-sm text-brand-secondary">La solicitud no modifica ni elimina datos automáticamente.</p>
          <form className="mt-5 space-y-4" onSubmit={request}>
            <div><label htmlFor="privacy-request-type" className="field-label">Tipo</label><select id="privacy-request-type" name="tipo" className="field" defaultValue="ACCESO">{privacyRequestTypes.map((type) => <option key={type} value={type}>{privacyRequestTypeLabels[type]}</option>)}</select></div>
            <div><label htmlFor="privacy-request-description" className="field-label">Descripción</label><textarea id="privacy-request-description" name="descripcion" className="field min-h-32 resize-y" minLength={10} maxLength={2000} required placeholder="Explica qué información o acción solicitas." /></div>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Enviando…" : "Enviar solicitud"}</button>
          </form>
        </article>
      </div>

      <article className="panel mt-5 overflow-hidden"><div className="border-b border-brand-border p-5 sm:px-7"><h3 className="text-lg font-semibold">Mis solicitudes</h3></div>
        {!privacy.requests.length ? <p className="p-6 text-sm text-brand-secondary">Aún no tienes solicitudes registradas.</p> : <ol className="divide-y divide-brand-border">{privacy.requests.map((item) => <li key={item.id} className="p-5 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{privacyRequestTypeLabels[item.tipo]}</p><p className="mt-1 text-xs text-brand-secondary">Creada {dateTime(item.created_at)}</p></div><Status state={item.estado} /></div><p className="mt-3 whitespace-pre-wrap text-sm text-brand-secondary">{item.descripcion}</p>{item.respuesta && <div className="mt-4 rounded-xl bg-brand-bg p-4 text-sm"><p className="font-medium">Respuesta</p><p className="mt-2 whitespace-pre-wrap text-brand-secondary">{item.respuesta}</p></div>}</li>)}</ol>}
      </article>
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function Status({ state }: { state: keyof typeof privacyRequestStateLabels }) { return <span className="rounded-full border border-brand-copper/40 bg-brand-copper/10 px-3 py-1 text-xs font-semibold">{privacyRequestStateLabels[state]}</span>; }
function dateTime(value: string) { return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(value)); }
