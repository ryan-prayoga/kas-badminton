"use client";

import { useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  fmtDateHuman,
  MONTHS_FULL,
  parseLocalDate,
  relativeDay,
  toLocalIso,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIcon } from "@/components/kok/icons";

const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function startOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** Senin=0 … Minggu=6 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function shiftDays(iso: string, delta: number): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + delta);
  return toLocalIso(d);
}

function todayIso(): string {
  return toLocalIso(new Date());
}

function viewFromValue(iso: string): { y: number; m: number } {
  const d = parseLocalDate(iso) ?? new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
}

export function DateField({
  value,
  onChange,
  id,
  className,
  disabled,
  allowFuture = false,
  min,
  max,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Game dicatat setelah dimainkan, jadi default tolak tanggal depan. Turnamen
   *  bisa berlangsung beberapa hari ke depan — set true buat tanggal selesai. */
  allowFuture?: boolean;
  /** Tanggal paling awal yang boleh dipilih (YYYY-MM-DD). */
  min?: string;
  /** Tanggal paling akhir yang boleh dipilih (YYYY-MM-DD). */
  max?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => viewFromValue(value));

  const cells = useMemo(() => {
    const first = startOfMonth(view.y, view.m);
    const pad = mondayIndex(first);
    const total = daysInMonth(view.y, view.m);
    const out: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < pad; i++) out.push(null);
    for (let day = 1; day <= total; day++) {
      out.push({ iso: toLocalIso(new Date(view.y, view.m, day)), day });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view.y, view.m]);

  const today = todayIso();
  const label = value ? fmtDateHuman(value) : "Pilih tanggal";
  const rel = value ? relativeDay(value) : "";

  const isDisabledDate = (iso: string) =>
    (!allowFuture && iso > today) || (!!min && iso < min) || (!!max && iso > max);

  const pick = (iso: string) => {
    if (isDisabledDate(iso)) return;
    onChange(iso);
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Balik ke bulan tanggal yang aktif tiap dibuka, biar gak "nyangkut" di
        // bulan lain bekas navigasi sebelumnya.
        if (v) setView(viewFromValue(value));
      }}
    >
      <Popover.Trigger
        render={
          <button
            id={id}
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-11 w-full items-center gap-2.5 rounded-xl border border-input bg-surface px-3 text-left text-sm text-ink outline-none transition",
              "hover:border-court/35 focus-visible:border-court/50 focus-visible:ring-2 focus-visible:ring-court/15",
              open && "border-court/50 ring-2 ring-court/15",
              disabled && "pointer-events-none opacity-60",
              className,
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-court/10 text-court">
              <KIcon name="calendar" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold leading-tight">{label}</span>
              {rel && rel !== "Hari ini" && rel !== "Kemarin" ? (
                <span className="mt-0.5 block text-[11px] text-ink-faint">{rel}</span>
              ) : null}
            </span>
            <KIcon
              name="chevronDown"
              className={cn("size-4 shrink-0 text-ink-faint transition", open && "rotate-180")}
            />
          </button>
        }
      />

      {/* Portal + Positioner (floating-ui) biar kalender gak ketutup/kepotong overflow
       * sheet atau dialog tempatnya nempel — dulu posisinya absolute biasa, kepotong
       * kalau field-nya di tengah area yang scroll-nya pendek. */}
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-(--anchor-width)"
        >
          <Popover.Popup
            aria-label="Pilih tanggal"
            className={cn(
              "max-h-(--available-height) overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-pop outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            <div className="mb-2.5 flex gap-1.5">
              {[
                { label: "Hari ini", iso: today },
                { label: "Kemarin", iso: shiftDays(today, -1) },
              ].map((q) => {
                const active = value === q.iso;
                return (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => pick(q.iso)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      active
                        ? "bg-court text-white shadow-court"
                        : "bg-surface-2 text-ink-soft hover:bg-court/10 hover:text-court",
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>

            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="grid size-8 place-items-center rounded-lg text-ink-soft transition hover:bg-surface-2 hover:text-ink"
                aria-label="Bulan sebelumnya"
              >
                <ChevronLeft className="size-4" />
              </button>
              <p className="font-display text-sm font-bold tracking-tight text-ink">
                {MONTHS_FULL[view.m]} {view.y}
              </p>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="grid size-8 place-items-center rounded-lg text-ink-soft transition hover:bg-surface-2 hover:text-ink"
                aria-label="Bulan berikutnya"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="grid h-7 place-items-center text-[10px] font-bold uppercase tracking-wide text-ink-faint"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((cell, i) => {
                if (!cell) return <div key={`e-${i}`} className="h-9" />;
                const isSel = cell.iso === value;
                const isToday = cell.iso === today;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => pick(cell.iso)}
                    disabled={isDisabledDate(cell.iso)}
                    className={cn(
                      "grid h-9 place-items-center rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
                      isSel
                        ? "bg-court text-white shadow-court"
                        : isToday
                          ? "bg-court/10 text-court hover:bg-court/15"
                          : "text-ink hover:bg-surface-2",
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
