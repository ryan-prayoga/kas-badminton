"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gameMatchNumbers } from "@/lib/domain/game";
import { finalPlayedMatchId, matchPlayedDate, playedMatches } from "@/lib/domain/tournament";
import type { BracketMatch, EnrichedGame, EnrichedTournament } from "@/lib/domain/types";
import { currentPeriodKey, fmt, fmtDateFull, periodKey, toLocalIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GameCard } from "@/components/kok/game-card";
import { TournamentHistoryCard } from "@/components/kok/tournament-history-card";
import { PeriodFilter } from "@/components/kok/period-filter";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon } from "@/components/kok/icons";
import type { PhotoMap } from "@/components/kok/avatar";

/** Satu turnamen di satu tanggal — cuma partai yang beneran dimainkan tanggal itu. */
interface TournamentDateEntry {
  tournament: EnrichedTournament;
  matches: BracketMatch[];
  /** Iuran belum lunas punya tournament ini — cuma diisi di grup tanggal partai penentunya. */
  unpaidCount: number;
}

interface Group {
  date: string;
  games: EnrichedGame[];
  tournamentEntries: TournamentDateEntry[];
  total: number;
  unpaidCount: number;
}

/**
 * Game dan partai turnamen digabung per tanggal partai itu beneran dimainkan
 * (`match.score.playedAt`, jatuh ke tanggal mulai turnamen kalau kosong) — bukan
 * cuma tanggal mulai turnamen. Satu turnamen bisa kepisah ke beberapa grup
 * tanggal kalau partainya memang dicatat di hari yang berbeda-beda.
 *
 * `period` (kunci "YYYY-MM" atau "all") difilter di sini juga, per-partai —
 * bukan per-turnamen — soalnya partai yang sama bisa jatuh ke bulan berbeda.
 */
function groupByDate(
  games: EnrichedGame[],
  tournaments: EnrichedTournament[],
  period: string,
): Group[] {
  const map = new Map<string, Group>();
  const blank = (date: string): Group => ({
    date,
    games: [],
    tournamentEntries: [],
    total: 0,
    unpaidCount: 0,
  });

  for (const g of games) {
    const grp = map.get(g.date) ?? blank(g.date);
    grp.games.push(g);
    grp.total += g.cost.total;
    grp.unpaidCount += g.summary.unpaidCount;
    map.set(g.date, grp);
  }

  for (const t of tournaments) {
    const finalId = finalPlayedMatchId(t);
    const byDate = new Map<string, BracketMatch[]>();
    for (const m of playedMatches(t)) {
      const date = matchPlayedDate(t, m);
      if (period !== "all" && periodKey(date) !== period) continue;
      const arr = byDate.get(date) ?? [];
      arr.push(m);
      byDate.set(date, arr);
    }
    for (const [date, matches] of byDate) {
      const grp = map.get(date) ?? blank(date);
      // Iuran patungan dicatat per peserta turnamen, bukan per partai — cuma
      // dihitung sekali, di tanggal partai penentunya, biar tidak dobel kehitung
      // kalau partainya kepisah ke beberapa tanggal.
      const unpaidCount = matches.some((m) => m.id === finalId) ? t.cost.unpaidCount : 0;
      grp.tournamentEntries.push({ tournament: t, matches, unpaidCount });
      grp.total += matches.reduce((s, m) => s + m.kokTotal, 0);
      grp.unpaidCount += unpaidCount;
      map.set(date, grp);
    }
  }

  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
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
      // Flash transien dari perubahan data eksternal (realtime): butuh state + timer
      // yang stabil 1.7s lintas re-render insidental — pemakaian efek yang sah di sini.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(changed);
      const t = setTimeout(() => setFlash(new Set()), 1700);
      return () => clearTimeout(t);
    }
  }, [games]);
  return flash;
}

export function HistoryView({
  games,
  tournaments = [],
  photoMap,
  editable = false,
  kokTypes,
  players,
  defaultPrice,
}: {
  games: EnrichedGame[];
  tournaments?: EnrichedTournament[];
  photoMap: PhotoMap;
  editable?: boolean;
  kokTypes?: import("@/lib/domain/types").KokType[];
  players?: import("@/lib/domain/types").PlayerRow[];
  defaultPrice?: number;
}) {
  const today = toLocalIso(new Date());
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    for (const t of tournaments) {
      for (const m of playedMatches(t)) {
        const k = periodKey(matchPlayedDate(t, m));
        if (k) keys.add(k);
      }
    }
    return [...keys].sort().reverse();
  }, [games, tournaments]);

  const [period, setPeriod] = useState(() => {
    const cur = currentPeriodKey();
    return periods.includes(cur) ? cur : "all";
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const flash = useFlash(games);

  // Datang dari link "?date=..." (mis. klik tanggal di Rekap) → pindah ke bulan
  // yang benar, buka grupnya, lalu scroll ke situ begitu grupnya kerender.
  const [pendingScrollDate, setPendingScrollDate] = useState<string | null>(null);
  useEffect(() => {
    const dateParam = new URLSearchParams(window.location.search).get("date");
    if (!dateParam) return;
    const k = periodKey(dateParam);
    // Baca URL sekali pas mount buat sinkron ke param eksternal — bukan derive dari state React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(periods.includes(k) ? k : "all");
    setOpen((s) => (s[dateParam] ? s : { ...s, [dateParam]: true }));
    setPendingScrollDate(dateParam);
    // Cuma sekali pas mount — baca URL awal, bukan tiap `periods` berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kartu lapor jumlah "belum bayar" optimistiknya → badge grup ikut live, tak basi selama round-trip.
  const [liveUnpaid, setLiveUnpaid] = useState<Record<string, number>>({});
  const handlePaidChange = useCallback((gameId: string, unpaid: number) => {
    setLiveUnpaid((m) => (m[gameId] === unpaid ? m : { ...m, [gameId]: unpaid }));
  }, []);

  const filtered = period === "all" ? games : games.filter((g) => periodKey(g.date) === period);
  const groups = groupByDate(filtered, tournaments, period);
  const matchNumbers = gameMatchNumbers(filtered);
  const tournamentCount = new Set(groups.flatMap((g) => g.tournamentEntries.map((e) => e.tournament.id)))
    .size;
  const isOpen = (date: string, i: number) => (date in open ? open[date] : i === 0);

  // Baru scroll begitu grup tanggalnya beneran ada di DOM (nunggu `period` kesorot dulu).
  useEffect(() => {
    if (!pendingScrollDate) return;
    const el = document.getElementById(`hist-${pendingScrollDate}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Reset penanda "sudah discroll" — efek DOM (scroll) yang jadi tujuan, bukan derive state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingScrollDate(null);
  }, [pendingScrollDate, groups]);

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
          {tournamentCount > 0 && (
            <span className="tabular inline-flex items-center gap-1 rounded-full bg-paid/12 px-2 py-0.5 text-[11px] font-bold text-paid">
              <KIcon name="trophy" className="size-3" />
              {tournamentCount}
            </span>
          )}
        </div>
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
      </div>

      {groups.length === 0 ? (
        <EmptyPanel icon="racket" text="Belum ada game dicatat." />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((grp, i) => {
            const opened = isOpen(grp.date, i);
            const grpUnpaid = grp.games.reduce(
              (s, g) => s + (liveUnpaid[g.id] ?? g.summary.unpaidCount),
              0,
            );
            // Turnamen tidak punya toggle lunas per pemain — hitung dari iurannya.
            const grpTotalUnpaid =
              grpUnpaid + grp.tournamentEntries.reduce((s, e) => s + e.unpaidCount, 0);
            const allPaid = grpTotalUnpaid === 0;
            const panelId = `grp-${grp.date}`;
            // Flash realtime tak kelihatan kalau grup terlipat — pulse headernya biar sinyalnya sampai.
            const groupFlashing = !opened && grp.games.some((g) => flash.has(g.id));
            return (
              <div
                key={grp.date}
                id={`hist-${grp.date}`}
                className={cn(
                  "animate-rise overflow-hidden rounded-xl2 border border-line bg-surface-2/60",
                  groupFlashing && "flash-update",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [grp.date]: !opened }))}
                  aria-expanded={opened}
                  aria-controls={panelId}
                  className="flex w-full select-none items-center justify-between gap-2 p-3.5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-display font-bold text-ink">
                      <KIcon name="calendar" className="size-4 shrink-0 text-ink-faint" />
                      <span className="truncate">{fmtDateFull(grp.date)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                      {grp.games.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <KIcon name="racket" className="size-3.5" /> {grp.games.length} main
                        </span>
                      )}
                      {grp.tournamentEntries.length > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-paid">
                          <KIcon name="trophy" className="size-3.5" /> {grp.tournamentEntries.length}{" "}
                          turnamen
                        </span>
                      )}
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
                        <KIcon name="alert" className="size-3" /> {grpTotalUnpaid} belum
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
                <div className="acc-panel" data-open={opened} id={panelId}>
                  <div className="acc-inner">
                    {/* p-3 + gap: ruang border/shadow GameCard biar gak kepotong overflow parent */}
                    <div className="grid gap-3 border-t border-line p-3">
                      {grp.tournamentEntries.map((e) => (
                        <TournamentHistoryCard
                          key={e.tournament.id}
                          tournament={e.tournament}
                          matches={e.matches}
                          today={today}
                          editable={editable}
                          kokTypes={kokTypes}
                          defaultPrice={defaultPrice}
                        />
                      ))}
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
                          onPaidChange={handlePaidChange}
                          matchNumber={matchNumbers.get(g.id)}
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
