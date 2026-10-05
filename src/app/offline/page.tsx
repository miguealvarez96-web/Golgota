import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sin conexión | Gólgota CrossFit",
};

export default function OfflinePage() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem", background: "#F6F8FB", color: "#0A1D4A", fontFamily: "Arial, sans-serif" }}>
    <section style={{ width: "100%", maxWidth: "34rem", border: "1px solid #E2E7EF", borderRadius: "1rem", background: "#FFFFFF", padding: "2rem", textAlign: "center", boxShadow: "0 8px 28px -22px rgba(10,29,74,.22)" }}>
      {/* Recurso público directo: debe funcionar sin el optimizador durante el fallback offline. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/golgota-logo.png" alt="" width="72" height="72" style={{ width: "4.5rem", height: "4.5rem", objectFit: "contain", margin: "0 auto" }} />
      <p style={{ margin: "1.5rem 0 0", color: "#A7674E", fontSize: ".75rem", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase" }}>Gólgota CrossFit</p>
      <h1 style={{ margin: ".75rem 0 0", fontSize: "1.75rem" }}>Sin conexión</h1>
      <p style={{ margin: "1rem auto 0", color: "#6B738A", lineHeight: 1.65 }}>Revisa tu conexión e inténtalo nuevamente. Por seguridad, la información privada no se guarda para uso sin conexión.</p>
      <a href="/" style={{ display: "inline-block", marginTop: "1.5rem", borderRadius: ".75rem", background: "#0A1D4A", color: "#FFFFFF", padding: ".75rem 1rem", fontSize: ".875rem", fontWeight: 700, textDecoration: "none" }}>Intentar nuevamente</a>
    </section>
  </main>;
}
