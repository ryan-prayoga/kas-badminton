"use client";

import { useEffect } from "react";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Layout app ngunci `html`/`body` (`overflow: hidden`) dan scroll beneran ada di
 * div pembungkus. Tapi iOS tetap nge-scroll WINDOW sendiri buat naikin input di
 * atas keyboard — dan pas keyboard nutup, posisinya kadang gak dibalikin.
 * Hasilnya seluruh app ke-geser ke atas (bottom nav ilang di bawah layar) dan
 * user gak bisa scroll balik, karena body-nya emang dikunci: app nampak beku.
 *
 * Jaga-jaga: tiap keyboard nutup / viewport berubah / app balik ke foreground,
 * paksa window balik ke 0. Pas user masih ngetik sengaja dilewat biar gak
 * berantem sama scroll-into-view bawaan iOS.
 */
export function ViewportGuard() {
  useEffect(() => {
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const reset = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (isTyping()) return;
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
        if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
      });
    };

    /** Keyboard iOS butuh waktu buat nutup; cek beberapa kali. */
    const resetSoon = () => {
      timers.push(setTimeout(reset, 150), setTimeout(reset, 450));
    };

    const vv = window.visualViewport;
    window.addEventListener("focusout", resetSoon);
    window.addEventListener("orientationchange", resetSoon);
    window.addEventListener("pageshow", reset);
    document.addEventListener("visibilitychange", reset);
    vv?.addEventListener("resize", reset);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener("focusout", resetSoon);
      window.removeEventListener("orientationchange", resetSoon);
      window.removeEventListener("pageshow", reset);
      document.removeEventListener("visibilitychange", reset);
      vv?.removeEventListener("resize", reset);
    };
  }, []);

  return null;
}
