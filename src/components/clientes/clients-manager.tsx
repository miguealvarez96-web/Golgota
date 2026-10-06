"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import ClientForm from "./client-form";
import PortalIcon from "@/components/layout/portal-icon";
import VigencyBadge from "@/components/membresias/vigency-badge";
import { clientStates, displayDate, type ClientListRow, type ClientRow, type MembershipSummary } from "@/lib/clientes/model";
import type { Vigency } from "@/lib/membresias/grouping";

type Props = {
  clients: ClientListRow[]; total: number; page: number; pageSize: number; query: string; state: string;
  canEdit: boolean; memberships: Record<string, MembershipSummary>; membershipError: boolean;
};

export default function ClientsManager({ clients, total, page, pageSize, query, state, canEdit, memberships, membershipError }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<{ client: ClientRow | null } | null>(null);
  const [message, setMessage] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  function pageUrl(target: number, q = query, filter = state) {
    const params = new URLSearchParams();
    if (q) params.set("q", q); if (filter) params.set("estado", filter);
    if (target > 1) params.set("pagina", String(target));
    return `/clientes${params.size ? `?${params}` : ""}`;
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => router.push(pageUrl(1, String(data.get("q") ?? "").trim(), String(data.get("estado") ?? ""))));
  }
  function open(client: ClientRow | null, element: HTMLElement) { opener.current = element; setMessage(""); setForm({ client }); }
  function close() { setForm(null); (opener.current?.isConnected ? opener.current : newButton.current)?.focus(); }
  function membership(client: ClientListRow) {
    if (membershipError) return <span className="text-brand-secondary">No disponible</span>;
    const current = memberships[client.id];
    if (!current) return <span className="text-brand-secondary">Sin membresía</span>;
    const state = (["POR_INICIAR", "VIGENTE", "POR_VENCER", "VENCE_HOY", "VENCIDA"].includes(current.estado_vigencia)
      ? current.estado_vigencia : "POR_INICIAR") as Vigency;
    const remaining = current.dias_restantes < 0 ? "Vencida" : current.dias_restantes === 0 ? "Vence hoy" : `${current.dias_restantes} días restantes`;
    return <span className="block"><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{current.plan}</span><VigencyBadge state={state} /></span><span className="mt-2 block text-xs text-brand-secondary">{displayDate(current.fecha_inicio)} — {displayDate(current.fecha_fin)} · {remaining}</span></span>;
  }
  const editButton = (client: ClientRow) => <button type="button" className="btn-secondary" onClick={(event) => open(client, event.currentTarget)} aria-label={`Editar a ${client.nombre_completo}`}>Editar</button>;
  const hasPrivateDetails = (client: ClientListRow): client is ClientRow => "cedula" in client;

  return (
    <main className="portal-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="eyebrow">Comunidad Gólgota</p><h1 className="page-title mt-2">Clientes</h1><p className="mt-2 text-sm text-brand-secondary">Personas, contacto y estado de tu comunidad.</p></div>
        <button ref={newButton} type="button" className="btn-primary" onClick={(event) => open(null, event.currentTarget)}><PortalIcon name="plus" />Nuevo cliente</button>
      </div>
      {message && <p role="status" className="mt-5 rounded-xl border border-brand-copper/50 bg-brand-copper/10 p-4 text-sm">{message}</p>}
      <form key={`${query}:${state}`} onSubmit={search} className="panel mt-7 grid items-end gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:p-5" role="search">
        <div><label htmlFor="client-search" className="field-label">Buscar cliente</label><input id="client-search" name="q" type="search" className="field" defaultValue={query} maxLength={100} placeholder={canEdit ? "Nombre, cédula, teléfono o correo" : "Nombre del alumno"} /></div>
        <div><label htmlFor="client-state" className="field-label">Estado</label><select id="client-state" name="estado" defaultValue={state} className="field"><option value="">Todos los estados</option>{clientStates.map((value) => <option key={value}>{value}</option>)}</select></div>
        <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Buscando…" : "Buscar"}</button>
      </form>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-secondary">
        <p role="status">{pending ? "Actualizando resultados…" : `${total.toLocaleString("es-EC")} ${total === 1 ? "cliente encontrado" : "clientes encontrados"}`}</p>
        {(query || state) && <Link href="/clientes" className="underline underline-offset-4 hover:text-brand-text">Limpiar filtros</Link>}
      </div>
      {membershipError && <p role="status" className="mb-4 text-sm text-brand-secondary">El listado está disponible, pero no pudimos consultar la vigencia de las membresías.</p>}
      <div aria-busy={pending} className={pending ? "opacity-60" : ""}>
        {!clients.length ? (
          <div className="panel py-16 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-brand-copper/50 text-brand-copper"><PortalIcon name="clients" /></div><h2 className="text-lg font-semibold">{total > 0 ? "Esta página no tiene resultados" : "No hay clientes para mostrar"}</h2><p className="mx-auto mt-2 max-w-sm px-4 text-sm text-brand-secondary">{query || state ? "Prueba con otros filtros o una búsqueda diferente." : "Registra el primer cliente para comenzar."}</p>{page > pages && <Link className="btn-secondary mt-4" href={pageUrl(1)}>Ir a la primera página</Link>}</div>
        ) : (
          <>
            <div className="panel hidden overflow-hidden xl:block"><table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Listado de clientes y estado de membresía</caption>
              <thead className="border-b border-brand-muted/30 bg-brand-bg/30 text-xs uppercase tracking-wider text-brand-secondary"><tr><th scope="col" className="w-1/4 p-4">Cliente</th>{canEdit && <th scope="col" className="p-4">Contacto</th>}<th scope="col" className="p-4">Estado</th><th scope="col" className="p-4">Membresía</th>{canEdit && <th scope="col" className="w-24 p-4"><span className="sr-only">Acciones</span></th>}</tr></thead>
              <tbody className="divide-y divide-brand-muted/20">{clients.map((client) => <tr key={client.id} className="hover:bg-brand-bg/20"><td className="p-4 align-top"><p className="font-semibold">{client.nombre_completo}</p>{canEdit && hasPrivateDetails(client) && <p className="mt-1 text-xs text-brand-secondary">ID · {client.cedula}</p>}</td>{canEdit && hasPrivateDetails(client) && <td className="break-words p-4 align-top"><p>{client.celular || "Sin teléfono"}</p><p className="mt-1 text-xs text-brand-secondary">{client.email || "Sin correo"}</p></td>}<td className="p-4 align-top"><ClientStatus value={client.estado_cliente} />{canEdit && hasPrivateDetails(client) && <p className="mt-2 text-xs text-brand-secondary">{displayDate(client.fecha_registro)}</p>}</td><td className="p-4 align-top text-xs">{membership(client)}</td>{canEdit && hasPrivateDetails(client) && <td className="p-3 align-top">{editButton(client)}</td>}</tr>)}</tbody>
            </table></div>
            <div className="grid gap-4 md:grid-cols-2 xl:hidden">{clients.map((client) => <article key={client.id} className="panel min-w-0 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{client.nombre_completo}</h2>{canEdit && hasPrivateDetails(client) && <p className="mt-1 text-xs text-brand-secondary">ID · {client.cedula}</p>}</div><ClientStatus value={client.estado_cliente} /></div><dl className="mt-5 space-y-3 text-sm">{canEdit && hasPrivateDetails(client) && <><div><dt className="text-xs text-brand-secondary">Teléfono</dt><dd className="mt-1">{client.celular || "Sin teléfono"}</dd></div><div><dt className="text-xs text-brand-secondary">Correo</dt><dd className="mt-1 break-words">{client.email || "Sin correo"}</dd></div><div><dt className="text-xs text-brand-secondary">Fecha de registro</dt><dd className="mt-1">{displayDate(client.fecha_registro)}</dd></div></>}<div><dt className="text-xs text-brand-secondary">Membresía actual</dt><dd className="mt-1">{membership(client)}</dd></div></dl>{canEdit && hasPrivateDetails(client) && <div className="mt-5 border-t border-brand-muted/30 pt-4">{editButton(client)}</div>}</article>)}</div>
          </>
        )}
      </div>
      {(pages > 1 || page > 1) && <nav aria-label="Páginas de clientes" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-brand-secondary">Página {page} de {pages} · {pageSize} por página</span><div className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={pageUrl(page - 1)}>Anterior</Link>}{page < pages && <Link className="btn-secondary" href={pageUrl(page + 1)}>Siguiente</Link>}</div></nav>}
      {form && <ClientForm client={form.client} membership={form.client ? memberships[form.client.id] : undefined} onClose={close} onSaved={(notice) => { close(); setMessage(notice); startTransition(() => router.refresh()); }} />}
    </main>
  );
}

function ClientStatus({ value }: { value: ClientRow["estado_cliente"] }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${value === "Activo" ? "border-brand-copper/60 bg-brand-copper/10 text-brand-text" : "border-brand-muted/40 text-brand-secondary"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${value === "Activo" ? "bg-brand-copper" : "bg-brand-muted"}`} />{value ?? "Sin estado"}</span>;
}
