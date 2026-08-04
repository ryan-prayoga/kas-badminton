"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Penyelamat terakhir buat app standalone di iOS.
 *
 * Pas app dibekukan di background, soket keep-alive-nya bisa mati tanpa kabar.
 * Balik ke foreground, request berikutnya gak langsung gagal — dia NGGANTUNG
 * sampai TCP timeout. Fetch punya kita sendiri sudah dikasih batas waktu
 * (`safeAction`, service worker), tapi navigasi RSC milik Next (`<Link>`, bottom
 * nav) gak bisa disetel dari luar: tab dipencet, gak ada yang terjadi, app
 * kelihatan beku padahal cuma nunggu soket busuk.
 *
 * Jadi tiap balik ke foreground kita colek `/api/health` dengan batas waktu.
 * Kalau gagal padahal browser bilang masih online, koneksinya yang busuk —
 * muat ulang halaman (jalan yang sama yang biasa dipakai user buat "membangunkan"
 * app, cuma otomatis). Kalau lagi ada dialog kebuka / lagi ngetik, jangan
 * dimuat ulang — isian user bisa hilang; cukup kasih tahu lewat toast.
 */

const PROBE_TIMEOUT_MS = 6000;
/** Jeda antar probe — flip background/foreground bisa beruntun. */
const MIN_GAP_MS = 20_000;
/** Jeda sebelum percobaan kedua; sekali gagal bisa cuma sial. */
const RETRY_GAP_MS = 1500;

function isBusy(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

async function probe(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function ConnectionWatchdog() {
  useEffect(() => {
    let last = 0;
    let running = false;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (disposed || running) return;
      if (document.visibilityState !== "visible") return;
      // beneran offline → RetryButton / event `online` yang urus, bukan reload
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;

      running = true;
      try {
        if (await probe()) return;
        await new Promise<void>((r) => {
          retry = setTimeout(r, RETRY_GAP_MS);
        });
        if (disposed || !navigator.onLine) return;
        if (await probe()) return;
        if (disposed) return;

        if (isBusy()) toast.error("Koneksi bermasalah — coba lagi.");
        else window.location.reload();
      } finally {
        running = false;
      }
    };

    const onVisible = () => void check();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  return null;
}
