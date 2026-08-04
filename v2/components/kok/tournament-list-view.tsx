"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { pairLabel, tournamentStatus } from "@/lib/domain/tournament";
import type { EnrichedTournament, PlayerRow } from "@/lib/domain/types";
import { currentPeriodKey, fmt, fmtDateRange, periodKey, toLocalIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CreateTournamentSheet } from "@/components/kok/create-tournament-sheet";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon } from "@/components/kok/icons";
import { PeriodFilter } from "@/components/kok/period-filter";
import { STATUS_META } from "@/components/kok/tournament-detail-view";

function TournamentCard({ t, today }: { t: EnrichedTournament; today: string }) {
  const status = tournamentStatus(t, today);
  const meta = STATUS_META[status];
  const feeLeft = t.cost.unpaidCount;

  return (
    <Link
      href={`/turnamen/${t.id}`}
      className="animate-rise block rounded-xl2 border border-line bg-surface-2/60 p-3.5 transition hover:border-court/40 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display truncate text-[0.95rem] font-bold text-ink">{t.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-soft">
            <span className="inline-flex items-center gap-1">
              <KIcon name="calendar" className="size-3.5" /> {fmtDateRange(t.date, t.endDate)}
            </span>
            <span className="inline-flex items-center gap-1">
              <KIcon name={t.format === "knockout" ? "trophy" : "chart"} className="size-3.5" />
              {t.size} pasang
            </span>
            <span className="inline-flex items-center gap-1">
              <KIcon name="shuttle" className="size-3.5" /> {t.cost.kokCount} kok
            </span>
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold",
            meta.className,
          )}
        >
          <KIcon name={meta.icon} className="size-3" />
          {meta.label}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {t.champion ? (
          <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-paid">
            <KIcon name="trophy" className="size-3.5 shrink-0" />
            <span className="truncate">{pairLabel(t.champion)}</span>
          </span>
        ) : t.totalCount > 0 ? (
          <span className="inline-flex items-center gap-1 font-semibold text-ink-soft">
            <KIcon name="racket" className="size-3.5" /> {t.playedCount}/{t.totalCount} partai
          </span>
        ) : null}
        {t.fee > 0 ? (
          feeLeft > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold text-owe">
              <KIcon name="alert" className="size-3.5" /> {feeLeft} belum patungan ·{" "}
              {fmt(t.cost.feeUnpaid)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-paid">
              <KIcon name="checkCircle" className="size-3.5" /> Patungan lunas
            </span>
          )
        ) : (
          <span className="text-ink-faint">Tanpa iuran</span>
        )}
      </div>
    </Link>
  );
}

export function TournamentListView({
  tournaments,
  editable,
  players,
}: {
  tournaments: EnrichedTournament[];
  editable: boolean;
  players: PlayerRow[];
}) {
  const today = toLocalIso(new Date());
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tournaments) {
      const k = periodKey(t.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [tournaments]);

  const [period, setPeriod] = useState(() => {
    const cur = currentPeriodKey();
    return periods.includes(cur) ? cur : "all";
  });

  const filtered =
    period === "all" ? tournaments : tournaments.filter((t) => periodKey(t.date) === period);

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name="trophy" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Turnamen</h2>
          <span className="tabular rounded-full bg-court/10 px-2 py-0.5 text-[11px] font-bold text-court">
            {filtered.length}
          </span>
        </div>
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
      </div>

      {editable ? (
        <div className="mb-3">
          <CreateTournamentSheet players={players} />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyPanel icon="trophy" text="Belum ada turnamen." />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((t) => (
            <TournamentCard key={t.id} t={t} today={today} />
          ))}
        </div>
      )}
    </section>
  );
}
