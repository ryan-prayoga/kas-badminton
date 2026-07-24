"use client";

import { useTheme } from "next-themes";
import { useMounted } from "@/lib/use-mounted";
import { withThemeTransition } from "@/lib/theme-transition";
import { KIcon, type IconName } from "@/components/kok/icons";

const OPTIONS: { value: string; label: string; desc: string; icon: IconName }[] = [
  { value: "light", label: "Terang", desc: "Selalu mode terang.", icon: "sun" },
  { value: "dark", label: "Gelap", desc: "Selalu mode gelap.", icon: "moon" },
  {
    value: "system",
    label: "Ikut sistem",
    desc: "Ganti otomatis ngikut setelan HP.",
    icon: "themeAuto",
  },
];

export function ThemePanel() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Tema cuma kebaca di client — sebelum mount, `theme` masih undefined.
  const mounted = useMounted();

  const current = mounted ? (theme ?? "system") : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-px">
      <div className="rounded-xl2 border border-line bg-surface p-1.5 shadow-card">
        {OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => withThemeTransition(() => setTheme(opt.value))}
              className={
                "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition active:scale-[0.99] " +
                (active ? "bg-court/10" : "hover:bg-surface-2")
              }
            >
              <span
                className={
                  "grid size-9 shrink-0 place-items-center rounded-xl " +
                  (active ? "bg-court text-white shadow-court" : "bg-surface-2 text-court")
                }
              >
                <KIcon name={opt.icon} className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-semibold text-ink">{opt.label}</span>
                <span className="block text-xs text-ink-soft">{opt.desc}</span>
              </span>
              {active ? <KIcon name="check" className="size-5 shrink-0 text-court" /> : null}
            </button>
          );
        })}
      </div>

      <p className="px-1 text-xs text-ink-faint">
        {mounted && theme === "system"
          ? `Sekarang: ${resolvedTheme === "dark" ? "gelap" : "terang"} (ngikut sistem).`
          : "Pilihan disimpan di HP ini."}
      </p>
    </div>
  );
}
