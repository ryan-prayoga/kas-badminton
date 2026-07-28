"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/** Harus sama dengan `--bg` di globals.css. */
const BG = { light: "#eef2f8", dark: "#0a1120" } as const;

/**
 * iOS standalone mewarnai status bar dari `<meta name="theme-color">`.
 * Metadata Next nulis dua meta ber-`media: prefers-color-scheme`, jadi kalau
 * user override tema di app (next-themes) sementara tema sistem beda, status
 * bar-nya jadi gak nyambung sama layar. Di sini kita timpa isi kedua meta itu
 * pakai tema yang benar-benar aktif.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    const color = resolvedTheme === "dark" ? BG.dark : BG.light;
    const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = color;
      document.head.appendChild(meta);
      return;
    }
    metas.forEach((m) => m.setAttribute("content", color));
  }, [resolvedTheme]);

  return null;
}
