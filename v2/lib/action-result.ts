/** Bentuk hasil server action. Dipisah dari `action-util` (server-only) biar
 *  komponen klien bisa ikut pakai tipe + pembungkus `safeAction` di bawah. */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; status: number };

/** Status buat gagal di sisi klien (jaringan mati / request digugurkan). */
export const CLIENT_ERROR_STATUS = 0;

export const NETWORK_ERROR = "Koneksi bermasalah — coba lagi.";

export const TIMEOUT_ERROR = "Server gak jawab — cek koneksi, lalu coba lagi.";

/** Batas tunggu default satu server action. */
export const ACTION_TIMEOUT_MS = 20_000;

/** Buat aksi yang ngirim payload besar (foto ~600KB data URL) di jaringan lelet. */
export const UPLOAD_TIMEOUT_MS = 60_000;

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
 * Kasus kedua yang lebih licik: request-nya gak reject, tapi NGGANTUNG. Soket
 * yang mati diam-diam pas app dibekukan iOS bikin fetch berikutnya diam sampai
 * TCP timeout (bisa semenit lebih). Selama itu `startTransition` masih pending,
 * jadi semua tombol yang di-disable pakai `pending` kekunci — persis rasa
 * "stuck gak bisa diapa-apain". Makanya di sini ada batas waktu: lewat itu kita
 * berhenti nunggu, UI kebuka lagi, user dikasih toast buat nyoba ulang.
 *
 * Bungkus tiap pemanggilan: gagal jaringan turun jadi ActionResult error biasa,
 * cukup ditampilkan sebagai toast.
 */
export async function safeAction<T>(
  run: () => Promise<ActionResult<T>>,
  timeoutMs: number = ACTION_TIMEOUT_MS,
): Promise<ActionResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // .catch dipasang di sini, bukan lewat try/catch di sekitar race: kalau
  // timeout menang duluan, promise aslinya masih hidup dan reject-nya nanti
  // bakal jadi unhandled rejection.
  const action = run().catch<ActionResult<T>>(() => ({
    ok: false,
    error: NETWORK_ERROR,
    status: CLIENT_ERROR_STATUS,
  }));

  const timeout = new Promise<ActionResult<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: TIMEOUT_ERROR, status: CLIENT_ERROR_STATUS }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([action, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
