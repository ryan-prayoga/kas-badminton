"use client";

import { useEffect } from "react";

/**
 * Daftarin `/sw.js` (prod doang — di dev bikin chunk HMR ke-cache basi).
 * App standalone di iOS bisa idle berhari-hari tanpa reload, jadi tiap balik
 * ke foreground kita panggil `update()` supaya versi baru kepasang.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;
    let disposed = false;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((r) => {
          if (disposed) return;
          reg = r;
        })
        .catch(() => {
          /* SW opsional — app tetap jalan tanpa ini */
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const onVisible = () => {
      if (document.visibilityState === "visible") void reg?.update();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
