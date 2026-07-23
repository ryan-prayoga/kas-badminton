"use client";

import { useMemo, useState } from "react";
import type { DebtEntry, EnrichedGame, KokType } from "@/lib/domain/types";
import { fmt, periodKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { PeriodFilter } from "@/components/kok/period-filter";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon, type IconName } from "@/components/kok/icons";

function StatCard({
  icon,
  iconClass,
  label,
  value,
  valueClass,
  sub,
}: {
  icon: IconName;
  iconClass: string;
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="animate-rise rounded-xl2 border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        <KIcon name={icon} className={cn("size-4", iconClass)} />
        {label}
      </div>
      <div className={cn("font-display tabular mt-1.5 text-2xl font-extrabold tracking-tight text-ink", valueClass)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

interface PlayerStat {
  name: string;
  main: number;
  keluar: number;
  nunggak: number;
}

export function StatsView({
  games,
  debts,
  kokTypes,
  photoMap,
}: {
  games: EnrichedGame[];
  debts: DebtEntry[];
  kokTypes: KokType[];
  photoMap: PhotoMap;
}) {
  const [period, setPeriod] = useState("all");

  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [games]);

  const scoped = period === "all" ? games : games.filter((g) => periodKey(g.date) === period);
  const totalDebt = debts.reduce((s, d) => s + d.total, 0);
  const totalKok = scoped.reduce((s, g) => s + g.cost.kokCount, 0);
  const stockLeft = kokTypes.reduce((s, t) => s + Math.max(0, Number(t.stock) || 0), 0);
  const typesWithStock = kokTypes.filter((t) => (Number(t.stock) || 0) > 0).length;

  const players = useMemo(() => {
    const map = new Map<string, PlayerStat>();
    for (const g of scoped) {
      for (const p of g.players) {
        if (!p.name) continue;
        const s = map.get(p.name) ?? { name: p.name, main: 0, keluar: 0, nunggak: 0 };
        s.main += 1;
        s.keluar += g.cost.perPerson;
        if (!p.paid) s.nunggak += g.cost.perPerson;
        map.set(p.name, s);
      }
    }
    return [...map.values()].sort(
      (a, b) => b.nunggak - a.nunggak || b.main - a.main || a.name.localeCompare(b.name, "id"),
    );
  }, [scoped]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon="cash"
          iconClass="text-owe"
          label="Belum bayar"
          value={fmt(totalDebt)}
          valueClass={totalDebt ? "text-owe" : "text-paid"}
          sub={debts.length ? `${debts.length} orang` : "Semua lunas"}
        />
        <StatCard
          icon="racket"
          iconClass="text-court"
          label="Total main"
          value={String(scoped.length)}
          sub={scoped.length ? "game tercatat" : "belum ada"}
        />
        <StatCard
          icon="shuttle"
          iconClass="text-court"
          label="Kok terpakai"
          value={String(totalKok)}
          sub="total kok"
        />
        <StatCard
          icon="package"
          iconClass={stockLeft > 0 ? "text-paid" : "text-danger"}
          label="Stok sisa"
          value={String(stockLeft)}
          valueClass={stockLeft > 0 ? "" : "text-danger"}
          sub={stockLeft > 0 ? `${typesWithStock} jenis tersedia` : "stok habis"}
        />
      </div>

      <div className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name="trophy" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Statistik pemain</h2>
        </div>
        {players.length === 0 ? (
          <EmptyPanel icon="racket" text="Belum ada pemain." />
        ) : (
          <div className="grid gap-2">
            {players.map((s, i) => (
              <div
                key={s.name}
                className="animate-rise flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3"
              >
                <span className="font-display tabular w-4 shrink-0 text-center text-sm font-bold text-ink-faint">
                  {i + 1}
                </span>
                <Avatar name={s.name} photo={photoMap[s.name]} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      <KIcon name="racket" className="size-3" /> {s.main} main
                    </span>
                    <span className="tabular inline-flex items-center gap-1 font-mono">
                      <KIcon name="cash" className="size-3" /> {fmt(s.keluar)}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {s.nunggak > 0 ? (
                    <>
                      <div className="tabular font-mono text-sm font-bold text-owe">{fmt(s.nunggak)}</div>
                      <div className="text-[10px] text-ink-faint">nunggak</div>
                    </>
                  ) : (
                    <div className="inline-flex items-center gap-1 text-sm font-bold text-paid">
                      <KIcon name="checkCircle" className="size-3.5" /> Lunas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
