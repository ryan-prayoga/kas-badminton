import type { Metadata } from "next";
import { AppFrame } from "@/components/kok/app-frame";
import { KIcon } from "@/components/kok/icons";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "Offline — Kok Badminton" };

/**
 * Fallback saat network mati. Di-precache service worker pas install, dan
 * disajikan buat request navigasi yang gagal. Wajib ada tombol reload sendiri:
 * mode standalone iOS gak punya address bar / tombol refresh.
 */
export default function OfflinePage() {
  return (
    <AppFrame eyebrow="Offline">
      <div className="flex flex-col items-center gap-4 rounded-xl2 border border-line bg-surface p-8 text-center shadow-card">
        <div className="grid size-14 place-items-center rounded-2xl bg-court/12 text-court">
          <KIcon name="racket" className="size-7" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-extrabold text-ink">Lagi offline</h2>
          <p className="text-sm text-ink-soft">
            Data kok butuh koneksi. Cek jaringan, terus coba lagi.
          </p>
        </div>
        <RetryButton />
      </div>
    </AppFrame>
  );
}
