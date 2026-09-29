"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveClient } from "@/app/(app)/clientes/actions";
import { businessDate, clientSchema, clientStates, type ClientInput, type ClientRow, type MembershipSummary } from "@/lib/clientes/model";

export default function ClientForm({ client, membership, onClose, onSaved }: {
  client: ClientRow | null; membership?: MembershipSummary; onClose: () => void; onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof ClientInput, string[]>>>({});
  const errorSummary = useRef<HTMLParagraphElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    const input = Object.fromEntries(data.entries());
    setError(""); setErrors({});
    const validation = clientSchema.safeParse(input);
    if (!validation.success) {
      setErrors(validation.error.flatten().fieldErrors); setError("Revisa los campos señalados."); return;
    }
    busy.current = true; setPending(true);
    try {
      const result = await saveClient(client?.id ?? null, input);
      if (result.ok) onSaved(result.message);
      else { setError(result.message); setErrors(result.errors ?? {}); }
    } catch {
      setError("No fue posible guardar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally { busy.current = false; setPending(false); }
  }

  const fieldError = (name: keyof ClientInput) => errors[name]?.length
    ? <p id={`${name}-error`} className="mt-1.5 text-sm text-red-700">{errors[name]?.[0]}</p> : null;

  return (
    <dialog ref={dialog} aria-labelledby="client-form-title" aria-describedby="client-form-description"
      onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
      className="panel m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-0 text-brand-text backdrop:bg-brand-text/30 backdrop:backdrop-blur-sm">
      <form onSubmit={submit} noValidate className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow">Gólgota CF · Clientes</p><h2 id="client-form-title" className="page-title mt-2">{client ? "Editar cliente" : "Nuevo cliente"}</h2></div>
          <button type="button" onClick={onClose} disabled={pending} className="btn-secondary" aria-label="Cerrar formulario">✕</button>
        </div>
        <p id="client-form-description" className="mt-3 text-sm text-brand-secondary">Los campos con * son obligatorios. La identificación es única por cliente.</p>
        {error && <p ref={errorSummary} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <fieldset disabled={pending} className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2"><label htmlFor="nombre_completo" className="field-label">Nombre completo *</label>
            <input autoFocus id="nombre_completo" name="nombre_completo" autoComplete="name" className="field" required minLength={2} maxLength={255} defaultValue={client?.nombre_completo ?? ""} aria-invalid={Boolean(errors.nombre_completo)} aria-describedby={errors.nombre_completo ? "nombre_completo-error" : undefined} />{fieldError("nombre_completo")}</div>
          <div><label htmlFor="cedula" className="field-label">Identificación / cédula *</label>
            <input id="cedula" name="cedula" className="field" inputMode="numeric" required maxLength={20} defaultValue={client?.cedula ?? ""} aria-invalid={Boolean(errors.cedula)} aria-describedby={errors.cedula ? "cedula-error" : undefined} />{fieldError("cedula")}</div>
          <div><label htmlFor="celular" className="field-label">Teléfono</label>
            <input id="celular" name="celular" type="tel" autoComplete="tel" className="field" maxLength={20} defaultValue={client?.celular ?? ""} aria-invalid={Boolean(errors.celular)} aria-describedby={errors.celular ? "celular-error" : undefined} />{fieldError("celular")}</div>
          <div className="sm:col-span-2"><label htmlFor="email" className="field-label">Correo electrónico</label>
            <input id="email" name="email" type="email" autoComplete="email" className="field" maxLength={255} defaultValue={client?.email ?? ""} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />{fieldError("email")}</div>
          <div><label htmlFor="estado_cliente" className="field-label">Estado *</label>
            <select id="estado_cliente" name="estado_cliente" className="field" defaultValue={client?.estado_cliente ?? "Activo"} aria-invalid={Boolean(errors.estado_cliente)} aria-describedby={errors.estado_cliente ? "estado_cliente-error" : undefined}>{clientStates.map((state) => <option key={state}>{state}</option>)}</select>{fieldError("estado_cliente")}</div>
          <div><label htmlFor="fecha_registro" className="field-label">Fecha de registro *</label>
            <input id="fecha_registro" name="fecha_registro" type="date" required className="field" max={businessDate()} defaultValue={client?.fecha_registro ?? businessDate()} aria-invalid={Boolean(errors.fecha_registro)} aria-describedby={errors.fecha_registro ? "fecha_registro-error" : undefined} />{fieldError("fecha_registro")}</div>
        </fieldset>
        <p className="mt-5 text-xs leading-relaxed text-brand-secondary">Para retirar a un cliente de la operación, cambia su estado a Inactivo. Su historial se conserva.</p>
        {client && <div className="mt-5 flex flex-wrap gap-2 border-t border-brand-border pt-5 text-sm">
          <Link className="btn-secondary" href={`/membresias/nueva?cliente=${client.id}`}>Crear membresía</Link>
          {membership && <Link className="btn-secondary" href={`/membresias/nueva?cliente=${client.id}&desde=${membership.id}`}>Renovar</Link>}
          <Link className="btn-secondary" href={`/membresias?cliente=${client.id}`}>Ver historial</Link>
        </div>}
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-brand-border pt-5">
          <button type="button" className="btn-secondary" disabled={pending} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Guardando…" : client ? "Guardar cambios" : "Crear cliente"}</button>
        </div>
      </form>
    </dialog>
  );
}
