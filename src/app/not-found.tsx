import Link from "next/link";
import Brand from "@/components/layout/brand";

export default function NotFound() {
  return <main className="flex min-h-screen items-center justify-center bg-brand-bg px-4 py-10 text-brand-text">
    <section className="panel w-full max-w-xl p-6 text-center sm:p-9">
      <div className="flex justify-center"><Brand subtitle="Página no encontrada" /></div>
      <p className="mt-8 text-6xl font-semibold text-brand-copper">404</p>
      <h1 className="mt-4 text-2xl font-semibold">Esta página no existe</h1>
      <p className="mt-3 text-sm leading-6 text-brand-secondary">Revisa la dirección o vuelve al acceso principal.</p>
      <Link href="/" className="btn-primary mt-6">Volver al portal</Link>
    </section>
  </main>;
}
