"use client";

import { useTheme } from "next-themes";
import { useMounted } from "@/lib/use-mounted";
import { withThemeTransition } from "@/lib/theme-transition";
import { KIcon } from "@/components/kok/icons";

/** Toggle terang/gelap ringkas buat header halaman publik. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Tema cuma kebaca di client — hindari mismatch ikon saat hydrate.
  const mounted = useMounted();

  const dark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={dark ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      title={dark ? "Mode terang" : "Mode gelap"}
      onClick={() => withThemeTransition(() => setTheme(dark ? "light" : "dark"))}
      className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-ink-soft transition hover:text-court active:scale-95"
    >
      <KIcon name={mounted ? (dark ? "sun" : "moon") : "themeAuto"} className="size-4.5" />
    </button>
  );
}
