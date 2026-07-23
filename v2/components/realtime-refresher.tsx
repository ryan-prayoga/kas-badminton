"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Buka SSE /api/events; tiap event mutasi → refresh RSC (live sync antar device). */
export function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");
      es.onmessage = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => router.refresh(), 120);
      };
      es.onerror = () => {
        es?.close();
        if (!stopped) setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      es?.close();
    };
  }, [router]);

  return null;
}
