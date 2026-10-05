"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaClient() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios && !standalone);

    function capturePrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }
    function installed() {
      setInstallPrompt(null);
      setIsIos(false);
      setShowIosHelp(false);
    }
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (!installPrompt && !isIos) return null;

  return <aside aria-live="polite" className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] rounded-2xl border border-brand-border bg-white p-3 text-sm text-brand-text shadow-lg sm:max-w-sm">
    {installPrompt ? <button type="button" className="btn-secondary" onClick={install}>Instalar Gólgota</button> : showIosHelp ? <div className="flex items-start gap-3"><p className="leading-6 text-brand-secondary">En Safari toca <strong className="text-brand-text">Compartir</strong> y luego <strong className="text-brand-text">Añadir a pantalla de inicio</strong>.</p><button type="button" className="shrink-0 px-2 py-1 font-semibold" aria-label="Cerrar ayuda de instalación" onClick={() => setShowIosHelp(false)}>×</button></div>
      : <button type="button" className="btn-secondary" onClick={() => setShowIosHelp(true)}>Cómo instalar</button>}
  </aside>;
}

