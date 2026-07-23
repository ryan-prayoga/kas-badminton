// QRIS statis → dinamis. Port addQrisReferenceLabel server.js.

import "server-only";
import { calculateCRC16, convertQRIS, parseTLV } from "@prasetya/qris";

export function addQrisReferenceLabel(payload: string, referenceLabel: string): string {
  const crcMatch = /6304[0-9A-Fa-f]{4}$/.test(payload);
  if (!crcMatch) return payload;
  if (parseTLV(payload).some((el: { tag: string }) => el.tag === "62")) return payload;
  const body = payload.slice(0, -8);
  const labelLen = Buffer.byteLength(referenceLabel, "utf8");
  const sub = "05" + String(labelLen).padStart(2, "0") + referenceLabel;
  const subLen = Buffer.byteLength(sub, "utf8");
  const tag62 = "62" + String(subLen).padStart(2, "0") + sub;
  const crcInput = body + tag62 + "6304";
  return crcInput + calculateCRC16(crcInput);
}

/** Generate payload QRIS dinamis dgn nominal. Throw kalau gagal. */
export function generateDynamicQris(merchant: string, amount: number): string {
  const referenceLabel = "KOK" + Date.now().toString(36).toUpperCase();
  return addQrisReferenceLabel(convertQRIS(merchant, { amount }), referenceLabel);
}
