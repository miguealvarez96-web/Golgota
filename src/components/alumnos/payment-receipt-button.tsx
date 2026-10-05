"use client";
/* eslint-disable @next/next/no-img-element -- la URL privada firmada cambia en cada apertura y no es compatible con optimización remota. */

import { useState } from "react";
import { getPaymentReceiptUrl } from "@/app/actions/payment-receipts";

export default function PaymentReceiptButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);

  async function openReceipt() {
    if (loading) return;
    setLoading(true);
    setError("");
    const result = await getPaymentReceiptUrl(reportId);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPreview({ url: result.url, mime: result.mime });
  }

  return <div className="mt-3">
    <button type="button" className="btn-secondary" onClick={openReceipt} disabled={loading}>
      {loading ? "Abriendo…" : "Ver comprobante"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {preview && <div role="dialog" aria-modal="true" aria-label="Vista previa del comprobante" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          {preview.mime === "application/pdf" && <a className="btn-secondary" href={preview.url} target="_blank" rel="noreferrer">Abrir PDF en otra pestaña</a>}
          <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>Cerrar</button>
        </div>
        {/* La URL es firmada, temporal y emitida solo después de autorizar el reporte. */}
        {preview.mime === "application/pdf"
          ? <iframe title={`Comprobante PDF del reporte ${reportId}`} src={preview.url} className="h-[75vh] w-full rounded-xl border border-brand-border" />
          : <img src={preview.url} alt={`Comprobante del reporte ${reportId}`} className="mx-auto max-h-[78vh] max-w-full rounded-xl object-contain" />}
      </div>
    </div>}
  </div>;
}
