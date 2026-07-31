"use client";

// Riwayat transaksi — kapan admin/operator nandain lunas/cicil, plus penyesuaian saldo kas.

import { useMemo, useState } from "react";
import type { PaymentHistoryEntry } from "@/lib/domain/types";
import { currentPeriodKey, fmt, fmtDateFull, fmtPaidAt, periodKey, toLocalIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon, type IconName } from "@/components/kok/icons";
import { PeriodFilter } from "@/components/kok/period-filter";

interface DayGroup {
  date: string;
  entries: PaymentHistoryEntry[];
  total: number;
}

/** Kas keluar (penyesuaian) mengurangi net; sisanya (lunas/cicil/kas masuk) menambah. */
function signedAmount(e: PaymentHistoryEntry): number {
  return e.type === "saldo_keluar" ? -e.amount : e.amount;
}

function groupByDay(entries: PaymentHistoryEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  const order: string[] = [];
  for (const e of entries) {
    const day = toLocalIso(new Date(e.createdAt));
    let g = map.get(day);
    if (!g) {
      g = { date: day, entries: [], total: 0 };
      map.set(day, g);
      order.push(day);
    }
    g.entries.push(e);
    g.total += signedAmount(e);
  }
  return order.map((date) => map.get(date)!);
}

const ENTRY_META: Record<
  PaymentHistoryEntry["type"],
  { label: string; tone: "paid" | "owe"; icon?: IconName }
> = {
  lunas: { label: "Lunas", tone: "paid" },
  cicil: { label: "Cicil", tone: "owe" },
  saldo_masuk: { label: "Kas masuk", tone: "paid", icon: "cashIn" },
  saldo_keluar: { label: "Kas keluar", tone: "owe", icon: "cashOut" },
};

function EntryRow({ entry, photoMap }: { entry: PaymentHistoryEntry; photoMap: PhotoMap }) {
  const { label, tone, icon } = ENTRY_META[entry.type];
  const isPaidTone = tone === "paid";
  return (
    <div className="flex items-center gap-2.5 bg-surface px-3 py-2.5 odd:bg-surface-2">
      <Avatar name={entry.name} photo={photoMap[entry.name]} size="size-8" tone={tone} icon={icon} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{entry.name}</span>
        {/* Badge pindah ke baris meta (bukan sebaris sama nama) — nama panjang (cth. keterangan
            penyesuaian saldo) gak lagi ngedorong badge/jumlah keluar layar di mobile. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-faint">
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              isPaidTone ? "bg-paid/12 text-paid" : "bg-owe/12 text-owe",
            )}
          >
            {label}
          </span>
          <span aria-hidden>·</span>
          <span>{fmtPaidAt(entry.createdAt)}</span>
          {entry.recordedBy && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">oleh {entry.recordedBy}</span>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          "tabular shrink-0 font-mono text-sm font-bold",
          isPaidTone ? "text-paid" : "text-owe",
        )}
      >
        {fmt(entry.amount)}
      </span>
    </div>
  );
}

export function PaymentHistoryView({
  entries,
  photoMap,
}: {
  entries: PaymentHistoryEntry[];
  photoMap: PhotoMap;
}) {
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const e of entries) {
      const k = periodKey(toLocalIso(new Date(e.createdAt)));
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [entries]);

  const [period, setPeriod] = useState(() => {
    const cur = currentPeriodKey();
    return periods.includes(cur) ? cur : "all";
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const filtered =
    period === "all"
      ? entries
      : entries.filter((e) => periodKey(toLocalIso(new Date(e.createdAt))) === period);
  const groups = groupByDay(filtered);
  const isOpen = (date: string, i: number) => (date in open ? open[date] : i === 0);

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name="history" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Riwayat transaksi</h2>
          <span className="tabular inline-flex items-center gap-1 rounded-full bg-court/10 px-2 py-0.5 text-[11px] font-bold text-court">
            {filtered.length}
          </span>
        </div>
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
      </div>

      {groups.length === 0 ? (
        <EmptyPanel icon="history" text="Belum ada riwayat transaksi" />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g, i) => {
            const opened = isOpen(g.date, i);
            const panelId = `pay-${g.date}`;
            return (
              <div
                key={g.date}
                className="animate-rise overflow-hidden rounded-xl2 border border-line bg-surface-2/60"
              >
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [g.date]: !opened }))}
                  aria-expanded={opened}
                  aria-controls={panelId}
                  className="flex w-full select-none items-center justify-between gap-2 p-3.5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-display font-bold text-ink">
                      <KIcon name="calendar" className="size-4 shrink-0 text-ink-faint" />
                      <span className="truncate">{fmtDateFull(g.date)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                      <span className="inline-flex items-center gap-1">
                        <KIcon name="cash" className="size-3.5" /> {g.entries.length} transaksi
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "tabular font-mono text-sm font-bold",
                        g.total < 0 ? "text-owe" : "text-paid",
                      )}
                    >
                      {fmt(g.total)}
                    </span>
                    <KIcon
                      name="chevronDown"
                      className={cn(
                        "size-5 shrink-0 text-ink-faint transition-transform duration-200",
                        opened && "rotate-180",
                      )}
                    />
                  </div>
                </button>
                <div className="acc-panel" data-open={opened} id={panelId}>
                  <div className="acc-inner">
                    <div className="grid gap-px overflow-hidden border-t border-line">
                      {g.entries.map((e) => (
                        <EntryRow key={e.id} entry={e} photoMap={photoMap} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
