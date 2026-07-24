// Formatter client-safe — port persis dari public.js app lama.

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** "Rp 3.000" (locale id-ID). */
export function fmt(n: number): string {
  return IDR.format(Number(n) || 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const MONTHS_FULL = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** "18 Jul 2026" dari YYYY-MM-DD. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** Parse YYYY-MM-DD → Date lokal (tengah malam). */
export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date lokal → YYYY-MM-DD. */
export function toLocalIso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** "24 Juli 2026" dari YYYY-MM-DD. */
export function fmtDateLong(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTHS_FULL[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Kamis, 24 Juli 2026". */
export function fmtDateFull(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return iso || "";
  return `${WEEKDAYS[d.getDay()]}, ${fmtDateLong(iso)}`;
}

/**
 * Label manusiawi untuk field tanggal:
 * - "Hari ini · Kamis, 24 Juli 2026"
 * - "Kemarin · Rabu, 23 Juli 2026"
 * - "Kamis, 17 Juli 2026" (lebih lama)
 */
export function fmtDateHuman(iso: string): string {
  const rel = relativeDay(iso);
  const full = fmtDateFull(iso);
  if (!full) return "";
  if (rel === "Hari ini" || rel === "Kemarin") return `${rel} · ${full}`;
  if (rel) return `${rel} · ${fmtDateLong(iso)}`;
  return full;
}

/** "18 Jul 2026, 09.39" dari ISO datetime (waktu lokal). */
export function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(`${y}-${mo}-${day}`)}, ${hh}.${mm}`;
}

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** "Hari ini" / "Kemarin" / "N hari lalu" (dalam 7 hari), else "". */
export function relativeDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayLocal())!;
  const today = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Kemarin";
  if (diff > 1 && diff < 7) return `${diff} hari lalu`;
  return "";
}

export function periodKey(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[1]}-${m[2]}` : "";
}

export function periodLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${MONTHS_FULL[Number(m[2]) - 1]} ${m[1]}`;
}

/** alias back-compat (komponen admin lama pakai nama ini). */
export const formatRupiah = fmt;
