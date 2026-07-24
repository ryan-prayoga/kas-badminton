"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * html/body dikunci (globals.css) — div ini yang jadi scroller beneran.
 * Next.js App Router reset scroll ke atas itu targetnya `window`; karena kita
 * gak lagi discroll di situ, reset manual di sini tiap pathname ganti biar
 * pindah tab nav gak kebawa posisi scroll halaman sebelumnya.
 */
export function ScrollContainer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div ref={ref} className="h-full overflow-y-auto overscroll-y-none">
      {children}
    </div>
  );
}
