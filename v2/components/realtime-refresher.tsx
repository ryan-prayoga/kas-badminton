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
    let retry: ReturnType<typeof setTimeout> | null = null;
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
      if (stopped || es) return;
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
        if (retry) clearTimeout(retry);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    /* iOS bekuin webview app standalone pas di-background. Balik ke foreground,
       EventSource sering "hidup" tapi mati diam-diam — `onerror` gak pernah
       nembak, jadi tanpa ini app nampak normal tapi datanya beku selamanya.
       Tiap balik visible: putus paksa, sambung ulang, tarik data terbaru. */
    const onVisible = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (retry) clearTimeout(retry);
      es?.close();
      es = null;
      connect();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      if (debounce) clearTimeout(debounce);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [router]);

  return null;
}
