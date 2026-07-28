/** Bentuk hasil server action. Dipisah dari `action-util` (server-only) biar
 *  komponen klien bisa ikut pakai tipe + pembungkus `safeAction` di bawah. */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; status: number };

/** Status buat gagal di sisi klien (jaringan mati / request digugurkan). */
export const CLIENT_ERROR_STATUS = 0;

export const NETWORK_ERROR = "Koneksi bermasalah — coba lagi.";

/**
 * Server action dipanggil lewat fetch. Kalau jaringannya putus — gampang banget
 * kejadian di PWA iOS pas app balik dari background dan soket keep-alive-nya
 * sudah mati — promise-nya REJECT, bukan balikin ActionResult.
 *
 * Reject di dalam `startTransition(async …)` gak ketangkep siapa-siapa: React
 * lempar ke error boundary terdekat, dan karena itu error render, SELURUH app
 * ganti jadi layar error. Di mode standalone gak ada address bar → user
 * kejebak, gak bisa ngapa-ngapain sampai app-nya dibunuh manual.
 *
 * Bungkus tiap pemanggilan: gagal jaringan turun jadi ActionResult error biasa,
 * cukup ditampilkan sebagai toast.
 */
export async function safeAction<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, error: NETWORK_ERROR, status: CLIENT_ERROR_STATUS };
  }
}
