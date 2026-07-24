"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * `false` di server + render hydrate pertama, `true` setelahnya.
 * Dipakai buat nilai yang cuma ada di client (tema, localStorage) biar
 * markup hydrate-nya tetap cocok — tanpa setState di dalam effect.
 */
export function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
