"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { setNavMode } from "@/lib/nav-mode";
import { setSessionAlive } from "@/lib/session-alive";
import { logout } from "@/server/actions/auth";

/** Buka SSE /api/events; mutasi → refresh RSC; session invalid → logout instan. */
export function RealtimeRefresher() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let loggingOut = false;

    const handleSessionInvalid = () => {
      if (loggingOut || stopped) return;
      loggingOut = true;

      // UI logout instan (SessionGuard → Lockscreen) sebelum network logout selesai
      setSessionAlive(false);
      setNavMode("admin");

      const onAdmin = pathnameRef.current.startsWith("/admin");
      if (onAdmin) {
        // tetap di /admin biar Lockscreen muncul; refresh bersihin props role
        router.replace("/admin");
      } else {
        // chrome admin di halaman publik → drop ke state publik + kasih tahu kenapa chrome hilang
        toast.info("Sesi admin berakhir");
        router.refresh();
      }

      void logout()
        .catch(() => {
          /* cookie mungkin sudah dibersihin server di connect */
        })
        .finally(() => {
          router.refresh();
          loggingOut = false;
        });
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");

      es.addEventListener("session", (ev) => {
        const data = (ev as MessageEvent).data;
        if (data === "invalid") handleSessionInvalid();
      });

      es.onmessage = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => router.refresh(), 120);
      };

      es.onerror = () => {
        es?.close();
        es = null;
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
