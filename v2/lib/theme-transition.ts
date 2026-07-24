"use client";

import { flushSync } from "react-dom";

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/**
 * Jalanin perubahan tema di dalam View Transition biar dapet reveal lingkaran
 * ber-blur (lihat `::view-transition-*` di globals.css).
 *
 * `flushSync` wajib: callback view transition harus udah selesai ganti DOM
 * (class `dark` di <html>) sebelum browser ngambil snapshot "new".
 * Browser tanpa View Transitions / user yang minta reduced motion langsung
 * ganti tanpa animasi.
 */
export function withThemeTransition(apply: () => void) {
  const doc = document as DocWithVT;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (typeof doc.startViewTransition !== "function" || reduceMotion) {
    apply();
    return;
  }

  doc.startViewTransition(() => flushSync(apply));
}
