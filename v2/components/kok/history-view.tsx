"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EnrichedGame } from "@/lib/domain/types";
import { fmt, fmtDate, periodKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GameCard } from "@/components/kok/game-card";
import { PeriodFilter } from "@/components/kok/period-filter";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon } from "@/components/kok/icons";
import type { PhotoMap } from "@/components/kok/avatar";

interface Group {
  date: string;
  games: EnrichedGame[];
  total: number;
  unpaidCount: number;
}

function groupByDate(games: EnrichedGame[]): Group[] {
  const map = new Map<string, Group>();
  const order: string[] = [];
  for (const g of games) {
    let grp = map.get(g.date);
    if (!grp) {
      grp = { date: g.date, games: [], total: 0, unpaidCount: 0 };
      map.set(g.date, grp);
      order.push(g.date);
    }
    grp.games.push(g);
    grp.total += g.cost.total;
    grp.unpaidCount += g.summary.unpaidCount;
  }
  return order.map((d) => map.get(d)!);
}

/** deteksi game yg berubah lewat realtime → flash sekejap. */
function useFlash(games: EnrichedGame[]): Set<string> {
  const prev = useRef<Map<string, string>>(new Map());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  useEffect(() => {
    const changed = new Set<string>();
    for (const g of games) {
      const before = prev.current.get(g.id);
      if (before !== undefined && before !== g.updatedAt) changed.add(g.id);
    }
    prev.current = new Map(games.map((g) => [g.id, g.updatedAt]));
    if (changed.size) {
      setFlash(changed);
      const t = setTimeout(() => setFlash(new Set()), 1700);
      return () => clearTimeout(t);
    }
  }, [games]);
  return flash;
}

export function HistoryView({
  games,
  photoMap,
  editable = false,
  kokTypes,
  players,
  defaultPrice,
}: {
  games: EnrichedGame[];
  photoMap: PhotoMap;
  editable?: boolean;
  kokTypes?: import("@/lib/domain/types").KokType[];
  players?: import("@/lib/domain/types").PlayerRow[];
  defaultPrice?: number;
}) {
  const [period, setPeriod] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const flash = useFlash(games);

  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [games]);

  const filtered = period === "all" ? games : games.filter((g) => periodKey(g.date) === period);
  const groups = groupByDate(filtered);
  const isOpen = (date: string, i: number) => (date in open ? open[date] : i === 0);

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name="history" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Riwayat</h2>
          <span className="tabular inline-flex items-center gap-1 rounded-full bg-court/10 px-2 py-0.5 text-[11px] font-bold text-court">
            <KIcon name="racket" className="size-3" />
            {filtered.length}
          </span>
        </div>
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
      </div>

      {groups.length === 0 ? (
        <EmptyPanel icon="racket" text="Belum ada game dicatat." />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((grp, i) => {
            const opened = isOpen(grp.date, i);
            const allPaid = grp.unpaidCount === 0;
            return (
              <div
                key={grp.date}
                className="animate-rise overflow-hidden rounded-xl2 border border-line bg-surface-2/60"
              >
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [grp.date]: !opened }))}
                  className="flex w-full select-none items-center justify-between gap-2 p-3.5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-display font-bold text-ink">
                      <KIcon name="calendar" className="size-4 shrink-0 text-ink-faint" />
                      <span className="truncate">{fmtDate(grp.date)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                      <span className="inline-flex items-center gap-1">
                        <KIcon name="racket" className="size-3.5" /> {grp.games.length} main
                      </span>
                      <span className="tabular inline-flex items-center gap-1 font-mono">
                        <KIcon name="cash" className="size-3.5" /> {fmt(grp.total)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {allPaid ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-paid/12 px-2 py-0.5 text-[11px] font-bold text-paid">
                        <KIcon name="checkCircle" className="size-3" /> Lunas
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-owe/12 px-2 py-0.5 text-[11px] font-bold text-owe">
                        <KIcon name="alert" className="size-3" /> {grp.unpaidCount} belum
                      </span>
                    )}
                    <KIcon
                      name="chevronDown"
                      className={cn(
                        "size-5 shrink-0 text-ink-faint transition-transform duration-200",
                        opened && "rotate-180",
                      )}
                    />
                  </div>
                </button>
                <div className="acc-panel" data-open={opened}>
                  <div className="acc-inner">
                    <div className="grid gap-3 border-t border-line p-3">
                      {grp.games.map((g) => (
                        <GameCard
                          key={g.id}
                          game={g}
                          photoMap={photoMap}
                          editable={editable}
                          flash={flash.has(g.id)}
                          kokTypes={kokTypes}
                          players={players}
                          defaultPrice={defaultPrice}
                        />
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
