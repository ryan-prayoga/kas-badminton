import { randomUUID } from "node:crypto";

/** ID unik — full UUID (valid buat kolom uuid & text). Port uid() server.js. */
export function uid(): string {
  return randomUUID();
}

/** Tanggal hari ini di zona WIB (YYYY-MM-DD). */
export function todayWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
