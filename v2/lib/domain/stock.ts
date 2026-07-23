// Logika stok kok — port dari server.js. Fungsi murni: hitung delta & validasi,
// biar repo layer yang nulis ke DB.

import type { Kok, KokType } from "./types";

export function parseStock(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export function countKoksByType(koks: Kok[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const k of koks ?? []) {
    const id = k?.typeId;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

/**
 * Delta stok per typeId untuk transisi oldKoks → newKoks.
 * Positif = stok nambah (kok dilepas), negatif = stok berkurang (kok dipakai).
 * Konsisten dgn applyKoksStockDiff lama: delta = oldCount − newCount.
 */
export function stockDeltas(
  oldKoks: Kok[] | undefined,
  newKoks: Kok[] | undefined,
): Map<string, number> {
  const oldMap = countKoksByType(oldKoks);
  const newMap = countKoksByType(newKoks);
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  const out = new Map<string, number>();
  for (const id of ids) {
    const delta = (oldMap.get(id) ?? 0) - (newMap.get(id) ?? 0);
    if (delta !== 0) out.set(id, delta);
  }
  return out;
}

/** Cek stok cukup buat selisih oldKoks→newKoks. Balik pesan error atau null. */
export function stockDiffError(
  kokTypes: KokType[],
  oldKoks: Kok[] | undefined,
  newKoks: Kok[] | undefined,
): string | null {
  const oldMap = countKoksByType(oldKoks);
  const newMap = countKoksByType(newKoks);
  for (const id of newMap.keys()) {
    const need = (newMap.get(id) ?? 0) - (oldMap.get(id) ?? 0);
    if (need <= 0) continue;
    const type = kokTypes.find((t) => t.id === id);
    if (!type) continue;
    const avail = Math.max(0, Number(type.stock) || 0);
    if (need > avail) {
      return `Stok ${type.name} tidak cukup (butuh ${need}, sisa ${avail})`;
    }
  }
  return null;
}
