"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewPrivacyRequest } from "@/app/(app)/solicitudes-privacidad/actions";
import {
  privacyRequestStateLabels,
  privacyRequestTypeLabels,
  type ManagementPrivacyRequest,
  type PrivacyRequestState,
} from "@/lib/privacidad/model";

type Filter = "TODAS" | PrivacyRequestState;
const filters: { value: Filter; label: string }[] = [
  { value: "TODAS", label: "Todas" },
  { value: "RECIBIDA", label: "Recibidas" },
  { value: "EN_REVISION", label: "En revisión" },
  { value: "ATENDIDA", label: "Atendidas" },
  { value: "RECHAZADA", label: "Rechazadas" },
];

export default function PrivacyRequestsManager({ requests }: { requests: ManagementPrivacyRequest[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("RECIBIDA");
  const [query, setQuery] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return requests.filter((request) => {
      const stateMatches = filter === "TODAS" || request.estado === filter;
      const queryMatches = !normalized || [request.solicitante_nombre, request.solicitante_email, request.descripcion]
        .some((value) => value.toLocaleLowerCase("es").includes(normalized));
      return stateMatches && queryMatches;
    });
  }, [filter, query, requests]);

  function review(request: ManagementPrivacyRequest, estado: "EN_REVISION" | "ATENDIDA" | "RECHAZADA") {
    if (pending || request.estado === "ATENDIDA" || request.estado === "RECHAZADA") return;
    const respuesta = (responses[request.id] ?? request.respuesta ?? "").trim();
    if ((estado === "ATENDIDA" || estado === "RECHAZADA") && respuesta.length < 3) {
      setMessage("");
      setError("Escribe una respuesta antes de cerrar la solicitud.");
      return;
    }
    setActiveId(request.id); setMessage(""); setError("");
    startTransition(async () => {
      const result = await reviewPrivacyRequest({ solicitud_id: request.id, estado, respuesta });
      if (result.ok) { setMessage(result.message); router.refresh(); }
      else setError(result.message);
      setActiveId(null);
    });
  }

  return <>
    <section className="panel p-4 sm:p-5" aria-label="Filtros de solicitudes de privacidad">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div><label htmlFor="privacy-search" className="field-label">Buscar solicitante</label><input id="privacy-search" type="search" className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o descripción" /></div>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar por estado">{filters.map((item) => <button key={item.value} type="button" className={filter === item.value ? "btn-primary" : "btn-secondary"} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label} ({item.value === "TODAS" ? requests.length : requests.filter((request) => request.estado === item.value).length})</button>)}</div>
      </div>
    </section>

    {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {!visible.length ? <div className="panel mt-5 p-10 text-center text-brand-secondary">No hay solicitudes que coincidan con el filtro.</div> : <div className="mt-5 grid gap-4">{visible.map((request) => {
      const closed = request.estado === "ATENDIDA" || request.estado === "RECHAZADA";
      return <article key={request.id} className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{request.solicitante_nombre}</h2><p className="mt-1 break-all text-sm text-brand-secondary">{request.solicitante_email}</p></div><Status state={request.estado} /></div>
        <dl className="mt-5 grid gap-4 border-t border-brand-border pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><Metric label="Tipo" value={privacyRequestTypeLabels[request.tipo]} /><Metric label="Recibida" value={dateTime(request.created_at)} /><Metric label="Última actualización" value={dateTime(request.updated_at)} /><Metric label="ID" value={request.id} /></dl>
        <div className="mt-4 rounded-xl bg-brand-bg p-4"><p className="text-xs font-medium uppercase tracking-wide text-brand-secondary">Solicitud</p><p className="mt-2 whitespace-pre-wrap text-sm">{request.descripcion}</p></div>
        {closed ? <div className="mt-4 rounded-xl border border-brand-border p-4 text-sm"><p className="font-medium">Respuesta registrada</p><p className="mt-2 whitespace-pre-wrap text-brand-secondary">{request.respuesta}</p><p className="mt-3 text-xs text-brand-secondary">Revisó: {request.revisor_nombre ?? request.reviewed_by ?? "No disponible"} · {request.reviewed_at ? dateTime(request.reviewed_at) : "Sin fecha"}</p></div> : <div className="mt-5 border-t border-brand-border pt-5"><label htmlFor={`privacy-response-${request.id}`} className="field-label">Respuesta de revisión</label><textarea id={`privacy-response-${request.id}`} className="field min-h-28 resize-y" maxLength={2000} value={responses[request.id] ?? request.respuesta ?? ""} onChange={(event) => setResponses((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Documenta la revisión y la respuesta al titular." /><div className="mt-4 flex flex-wrap justify-end gap-3">{request.estado === "RECIBIDA" && <button type="button" className="btn-secondary" disabled={pending} onClick={() => review(request, "EN_REVISION")}>Marcar en revisión</button>}<button type="button" className="btn-secondary" disabled={pending} onClick={() => review(request, "RECHAZADA")}>{activeId === request.id ? "Procesando…" : "Rechazar con respuesta"}</button><button type="button" className="btn-primary" disabled={pending} onClick={() => review(request, "ATENDIDA")}>{activeId === request.id ? "Procesando…" : "Marcar atendida"}</button></div></div>}
      </article>;
    })}</div>}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs text-brand-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>; }
function Status({ state }: { state: PrivacyRequestState }) { return <span className="rounded-full border border-brand-copper/40 bg-brand-copper/10 px-3 py-1 text-xs font-semibold">{privacyRequestStateLabels[state]}</span>; }
function dateTime(value: string) { return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(value)); }
