"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { prepareStudentRegistration } from "@/app/(auth)/registro/actions";
import { createClient } from "@/lib/supabase/client";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacidad/model";
import { studentRegistrationSchema, type StudentRegistrationInput } from "@/lib/registro/model";

type FieldErrors = Partial<Record<keyof StudentRegistrationInput, string[]>>;

export default function StudentRegistrationForm() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = {
      nombres: values.get("nombres"), apellidos: values.get("apellidos"),
      cedula: values.get("cedula"), celular: values.get("celular"), email: values.get("email"),
      password: values.get("password"), confirmPassword: values.get("confirmPassword"),
      aviso_version: PRIVACY_NOTICE_VERSION,
      aviso_leido: values.get("aviso_leido") === "on",
      comunicaciones_promocionales: values.get("comunicaciones_promocionales") === "on",
    };
    setError(""); setMessage(""); setErrors({});
    const validation = studentRegistrationSchema.safeParse(input);
    if (!validation.success) {
      setErrors(validation.error.flatten().fieldErrors); setError("Revisa los campos señalados."); return;
    }

    busy.current = true; setPending(true);
    try {
      const prepared = await prepareStudentRegistration(validation.data);
      if (!prepared.ok) {
        setError(prepared.message); setErrors((prepared.errors ?? {}) as FieldErrors); return;
      }
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: prepared.email,
        password: validation.data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal`,
          data: { student_registration_token: prepared.token },
        },
      });
      if (signUpError || !data.user) {
        const duplicate = signUpError?.code === "user_already_exists";
        setError(duplicate
          ? "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña."
          : "No fue posible crear la cuenta. Inténtalo de nuevo.");
        return;
      }
      if (data.user.identities?.length === 0) {
        setError("Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.");
        return;
      }
      if (data.session) {
        setMessage("Cuenta creada correctamente.");
        window.location.replace("/portal");
      } else {
        setMessage("Revisa tu correo para confirmar tu cuenta.");
        form.reset();
      }
    } catch {
      setError("No fue posible completar el registro. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      busy.current = false; setPending(false);
    }
  }

  const fieldError = (name: keyof StudentRegistrationInput) => errors[name]?.[0]
    ? <p id={`${name}-error`} className="mt-1.5 text-sm text-red-700">{errors[name]?.[0]}</p> : null;

  return <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
    <div className="grid gap-5 sm:grid-cols-2">
      <div><label className="field-label" htmlFor="nombres">Nombres</label><input className="field" id="nombres" name="nombres" autoComplete="given-name" required aria-describedby="nombres-error" />{fieldError("nombres")}</div>
      <div><label className="field-label" htmlFor="apellidos">Apellidos</label><input className="field" id="apellidos" name="apellidos" autoComplete="family-name" required aria-describedby="apellidos-error" />{fieldError("apellidos")}</div>
      <div><label className="field-label" htmlFor="cedula">Cédula / identificación</label><input className="field" id="cedula" name="cedula" inputMode="numeric" autoComplete="off" required aria-describedby="cedula-error" />{fieldError("cedula")}</div>
      <div><label className="field-label" htmlFor="celular">Teléfono</label><input className="field" id="celular" name="celular" type="tel" autoComplete="tel" required aria-describedby="celular-error" />{fieldError("celular")}</div>
    </div>
    <div><label className="field-label" htmlFor="email">Correo electrónico</label><input className="field" id="email" name="email" type="email" autoComplete="email" required aria-describedby="email-error" />{fieldError("email")}</div>
    <div className="grid gap-5 sm:grid-cols-2">
      <div><label className="field-label" htmlFor="password">Contraseña</label><input className="field" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-describedby="password-help password-error" /><p id="password-help" className="mt-1.5 text-xs text-brand-secondary">Mínimo 8 caracteres, con letras y números.</p>{fieldError("password")}</div>
      <div><label className="field-label" htmlFor="confirmPassword">Confirmar contraseña</label><input className="field" id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required aria-describedby="confirmPassword-error" />{fieldError("confirmPassword")}</div>
    </div>
    <label className="flex items-start gap-3 rounded-xl border border-brand-border bg-brand-bg p-4 text-sm leading-6"><input name="aviso_leido" type="checkbox" className="mt-1 h-4 w-4 accent-brand-copper" required /><span>He leído y acepto el <Link href="/privacidad" target="_blank" className="font-semibold underline decoration-brand-copper/60 underline-offset-4">aviso de privacidad vigente</Link>.</span></label>
    {fieldError("aviso_leido")}
    <label className="flex items-start gap-3 rounded-xl border border-brand-border p-4 text-sm leading-6"><input name="comunicaciones_promocionales" type="checkbox" className="mt-1 h-4 w-4 accent-brand-copper" /><span>Acepto recibir comunicaciones y promociones. Esta autorización es opcional.</span></label>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
    <button className="btn-primary min-h-12 w-full" type="submit" disabled={pending}>{pending ? "Creando cuenta..." : "Crear cuenta de alumno"}</button>
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
      <Link href="/login" className="font-medium underline decoration-brand-copper/60 underline-offset-4">Ya tengo cuenta</Link>
      <Link href="/login" className="font-medium underline decoration-brand-copper/60 underline-offset-4">Recuperar contraseña</Link>
      <Link href="/privacidad" className="font-medium underline decoration-brand-copper/60 underline-offset-4">Privacidad</Link>
    </div>
  </form>;
}
