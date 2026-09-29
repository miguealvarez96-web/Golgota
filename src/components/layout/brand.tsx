"use client";

import Image from "next/image";
import { useState } from "react";

export default function Brand() {
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div aria-hidden="true" className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-brand-copper/60 bg-brand-bg">
        {!logoLoaded && <span className="text-2xl font-black italic text-brand-copper">G</span>}
        {!logoFailed && (
          <Image src="/golgota-logo.png" alt="" width={44} height={44} unoptimized
            className={`absolute inset-0 h-full w-full object-contain ${logoLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLogoLoaded(true)} onError={() => { setLogoFailed(true); setLogoLoaded(false); }} />
        )}
      </div>
      <div>
        <p className="text-lg font-bold tracking-tight text-brand-text">Gólgota CF</p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-brand-secondary">Portal de administración</p>
      </div>
    </div>
  );
}
