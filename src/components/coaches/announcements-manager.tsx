"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { manageAnnouncementLifecycle, saveAnnouncement } from "@/app/(app)/comunicados/actions";
import PortalIcon from "@/components/layout/portal-icon";
import type { AnnouncementRow } from "@/lib/coaches/model";

export default function AnnouncementsManager({ announcements, canManage, canLifecycle, filter }: {
  announcements: AnnouncementRow[];
  canManage: boolean;
  canLifecycle: boolean;
  filter: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AnnouncementRow | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await saveAnnouncement(editing?.id ?? null, {
        titulo: String(data.get("titulo") ?? ""),
        contenido: String(data.get("contenido") ?? ""),
        publicado: data.get("publicado") === "on",
      });
      if (result.ok) {
        setNotice(result.message);
        setEditing(undefined);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }
  function lifecycle(announcement: AnnouncementRow) {
    const action = announcement.archivado ? "RESTAURAR" : "ELIMINAR";
    const prompt = announcement.archivado ? `¿Restaurar ${announcement.titulo}?` : "¿Está seguro de eliminar este registro? Si existe trazabilidad, el comunicado será archivado.";
    if (!window.confirm(prompt)) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await manageAnnouncementLifecycle(announcement.id, action);
      if (result.ok) { setNotice(result.message); router.refresh(); } else setError(result.message);
    });
  }

  const dateTime = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });

  return <main className="portal-page">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">Comunidad Gólgota</p><h1 className="page-title mt-2">Comunicados</h1><p className="mt-2 text-sm text-brand-secondary">{canManage ? "Redacta y publica avisos internos." : "Información reciente para el equipo."}</p></div>
      {canManage && <button type="button" className="btn-primary" onClick={() => { setEditing(null); setError(""); }}><PortalIcon name="plus" />Nuevo comunicado</button>}
    </div>
    {notice && <p role="status" className="mt-5 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">{notice}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {canLifecycle && <form action="/comunicados" className="panel mt-5 flex flex-wrap items-end gap-3 p-4"><div><label htmlFor="announcement-filter" className="field-label">Estado</label><select id="announcement-filter" name="filtro" className="field" defaultValue={filter}><option value="publicados">Publicados</option><option value="archivados">Archivados</option><option value="todos">Todos</option></select></div><button className="btn-secondary">Filtrar</button></form>}

    {editing !== undefined && <form key={editing?.id ?? "new"} onSubmit={submit} className="panel mt-7 grid gap-5 p-5 sm:p-6">
      <div><label htmlFor="announcement-title" className="field-label">Título *</label><input id="announcement-title" name="titulo" className="field" required maxLength={160} defaultValue={editing?.titulo ?? ""} /></div>
      <div><label htmlFor="announcement-content" className="field-label">Contenido *</label><textarea id="announcement-content" name="contenido" className="field min-h-40 resize-y" required maxLength={10000} defaultValue={editing?.contenido ?? ""} /></div>
      <label className="flex items-center gap-3 text-sm font-medium"><input name="publicado" type="checkbox" className="h-4 w-4 accent-brand-copper" defaultChecked={editing?.publicado ?? false} />Publicado</label>
      <div className="flex flex-wrap justify-end gap-3 border-t border-brand-border pt-5"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setEditing(undefined)}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar comunicado"}</button></div>
    </form>}

    <div className="mt-7 grid gap-5 md:grid-cols-2">
      {!announcements.length ? <div className="panel p-10 text-center md:col-span-2"><h2 className="font-semibold">No hay comunicados disponibles</h2><p className="mt-2 text-sm text-brand-secondary">{canManage ? "Crea el primer aviso para el equipo." : "Vuelve a consultar más tarde."}</p></div>
        : announcements.map((announcement) => <article key={announcement.id} className="panel flex min-w-0 flex-col p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold">{announcement.titulo}</h2>{canManage && <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${announcement.publicado && !announcement.archivado ? "border-brand-copper/50 bg-brand-copper/10" : "border-brand-border text-brand-secondary"}`}>{announcement.archivado ? "ARCHIVADO" : announcement.publicado ? "PUBLICADO" : "BORRADOR"}</span>}</div>
          {announcement.fecha_publicacion && <p className="mt-2 text-xs text-brand-secondary">Publicado {dateTime.format(new Date(announcement.fecha_publicacion))}</p>}
          <p className="mt-4 flex-1 whitespace-pre-wrap text-sm leading-7 text-brand-secondary">{announcement.contenido}</p>
          {canManage && <div className="mt-5 flex flex-wrap gap-2 border-t border-brand-border pt-4"><button type="button" className="btn-secondary" disabled={announcement.archivado} onClick={() => { setEditing(announcement); setError(""); }}>Editar</button>{canLifecycle && <button type="button" className={announcement.archivado ? "btn-secondary" : "btn-secondary text-red-700"} disabled={pending} onClick={() => lifecycle(announcement)}>{announcement.archivado ? "Restaurar" : "Eliminar / Archivar"}</button>}</div>}
        </article>)}
    </div>
  </main>;
}

