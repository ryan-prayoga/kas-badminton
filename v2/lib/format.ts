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
