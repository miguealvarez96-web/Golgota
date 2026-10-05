"use client";

import Link from "next/link";

export default function RouteError({ reset, destination, destinationLabel }: {
  reset: () => void;
  destination: string;
  destinationLabel: string;
}) {
  return <main className="portal-page">
    <div className="panel mx-auto max-w-2xl p-6 sm:p-8">
      <p className="eyebrow">Error de carga</p>
      <h1 className="page-title mt-2">No pudimos mostrar esta sección</h1>
      <p role="alert" className="mt-4 text-sm leading-6 text-brand-secondary">
        Comprueba tu conexión e inténtalo nuevamente. Si tu sesión venció, vuelve a iniciar sesión.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="btn-primary" onClick={reset}>Volver a intentar</button>
        <Link href={destination} className="btn-secondary">{destinationLabel}</Link>
        <Link href="/login" className="btn-secondary">Iniciar sesión</Link>
      </div>
    </div>
  </main>;
}
