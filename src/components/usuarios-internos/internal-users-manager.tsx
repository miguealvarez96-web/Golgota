"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createInternalUser, resetInternalPassword, updateInternalUser } from "@/app/(app)/usuarios/actions";
import PortalIcon from "@/components/layout/portal-icon";
import type { InternalRole, InternalUserRow } from "@/lib/usuarios-internos/model";

export default function InternalUsersManager({ users, loadError }: { users: InternalUserRow[]; loadError: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<InternalUserRow | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(loadError);

  function finish(result: { ok: boolean; message: string }) {
    setMessage(result.ok ? result.message : "");
    setError(result.ok ? "" : result.message);
    if (result.ok) {
      setCreating(false);
      setResetting(null);
      router.refresh();
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(async () => finish(await createInternalUser(new FormData(form))));
  }

  function update(user: InternalUserRow, rol: InternalRole, activo: boolean) {
    startTransition(async () => finish(await updateInternalUser({ id: user.id, rol, activo })));
  }

  function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetting) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => finish(await resetInternalPassword({
      id: resetting.id,
      password: data.get("password"),
      passwordConfirmation: data.get("passwordConfirmation"),
    })));
  }

  return <main className="portal-page">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="eyebrow">Acceso interno</p><h1 className="page-title mt-2">Usuarios internos</h1><p className="mt-2 text-sm text-brand-secondary">Cuentas administradas para owners y coaches. Los correos técnicos nunca se muestran.</p></div>
      <button type="button" className="btn-primary" onClick={() => { setCreating(true); setError(""); setMessage(""); }}><PortalIcon name="plus" />Nuevo usuario</button>
    </div>

    {message && <p role="status" className="mt-5 rounded-xl border border-brand-copper/40 bg-brand-copper/10 p-4 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    <div className="mt-7 overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
      {!users.length ? <p className="p-8 text-center text-sm text-brand-secondary">Todavía no hay usuarios internos.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-brand-border bg-brand-bg text-xs uppercase tracking-wider text-brand-secondary"><tr><th className="p-4">Nombre</th><th className="p-4">Usuario</th><th className="p-4">Rol</th><th className="p-4">Estado</th><th className="p-4 text-right">Acciones</th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.id} className="border-b border-brand-border last:border-0">
          <td className="p-4 font-medium">{user.nombre}</td><td className="p-4 font-mono text-brand-secondary">{user.login_username}</td>
          <td className="p-4"><select aria-label={`Rol de ${user.login_username}`} className="field max-w-32" value={user.rol} disabled={pending} onChange={(event) => update(user, event.target.value as InternalRole, user.activo)}><option value="owner">Owner</option><option value="staff">Staff</option></select></td>
          <td className="p-4"><span className={user.activo ? "text-emerald-700" : "text-brand-secondary"}>{user.activo ? "Activo" : "Inactivo"}</span></td>
          <td className="p-4"><div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setResetting(user)}>Contraseña</button><button type="button" className="btn-secondary" disabled={pending} onClick={() => update(user, user.rol, !user.activo)}>{user.activo ? "Inactivar" : "Activar"}</button></div></td>
        </tr>)}</tbody>
      </table></div>}
    </div>

    {creating && <Dialog title="Crear usuario interno" onClose={() => setCreating(false)}><form onSubmit={create} className="space-y-4">
      <Field label="Nombre" name="nombre" autoComplete="name" />
      <Field label="Usuario" name="username" autoComplete="off" pattern="[A-Za-z0-9._-]+" minLength={3} maxLength={50} />
      <div><label className="field-label" htmlFor="internal-role">Rol</label><select id="internal-role" name="rol" className="field"><option value="staff">Staff</option><option value="owner">Owner</option></select></div>
      <Field label="Contraseña inicial" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} />
      <Field label="Confirmar contraseña" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} />
      <label className="flex items-center gap-3 text-sm"><input name="activo" type="checkbox" defaultChecked />Cuenta activa</label>
      <SubmitRow pending={pending} onCancel={() => setCreating(false)} label="Crear usuario" />
    </form></Dialog>}

    {resetting && <Dialog title={`Restablecer contraseña de ${resetting.login_username}`} onClose={() => setResetting(null)}><form onSubmit={reset} className="space-y-4">
      <Field label="Nueva contraseña" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} />
      <Field label="Confirmar contraseña" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={8} maxLength={72} />
      <SubmitRow pending={pending} onCancel={() => setResetting(null)} label="Restablecer" />
    </form></Dialog>}
  </main>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-text/40 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-lg rounded-2xl border border-brand-border bg-brand-surface p-6 shadow-xl"><div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2><button type="button" className="text-brand-secondary" onClick={onClose} aria-label="Cerrar">Cerrar</button></div>{children}</div></div>;
}

function Field({ label, name, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return <div><label className="field-label" htmlFor={`internal-${name}`}>{label}</label><input id={`internal-${name}`} name={name} type={type} className="field" required {...props} /></div>;
}

function SubmitRow({ pending, onCancel, label }: { pending: boolean; onCancel: () => void; label: string }) {
  return <div className="flex justify-end gap-3 pt-2"><button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando…" : label}</button></div>;
}
