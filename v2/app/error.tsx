"use client";

import { useEffect } from "react";
import { AppFrame } from "@/components/kok/app-frame";
import { KIcon } from "@/components/kok/icons";

/**
 * Jaring pengaman render/aksi klien. Wajib ada buat PWA standalone: tanpa ini
 * error apa pun bikin Next nampilin layar error bawaan tanpa tombol reload,
 * dan di app home screen gak ada address bar buat keluar dari situ.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppFrame eyebrow="Ada yang error">
      <div className="flex flex-col items-center gap-4 rounded-xl2 border border-line bg-surface p-8 text-center shadow-card">
        <div className="grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
          <KIcon name="racket" className="size-7" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-extrabold text-ink">Gagal memuat</h2>
          <p className="text-sm text-ink-soft">
            Ada yang salah pas nampilin halaman ini. Coba muat ulang.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-court px-5 text-sm font-semibold text-white shadow-court transition hover:bg-court-deep active:scale-95"
          >
            Coba lagi
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-ink shadow-card transition active:scale-95"
          >
            Muat ulang app
          </button>
        </div>
      </div>
    </AppFrame>
  );
}
