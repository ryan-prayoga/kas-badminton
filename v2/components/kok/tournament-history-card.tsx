"use client";

// Kartu turnamen di halaman Riwayat. Sengaja beda dari GameCard: border emas +
// ribbon "Turnamen", tapi isi partai penentunya niru gaya GameCard — kotak
// lapangan dengan status lunas per pemain (dari iuran turnamen), plus baris
// skor per game ditumpuk (niru SideRow bagan) biar kelihatan mana yang menang.

import Link from "next/link";
import { matchTitle, pairLabel, tournamentStatus } from "@/lib/domain/tournament";
import type { BracketMatch, EnrichedTournament } from "@/lib/domain/types";
import { fmt, fmtDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIcon } from "@/components/kok/icons";
import { STATUS_META } from "@/components/kok/tournament-detail-view";

/** Partai paling menentukan yang sudah punya skor — final kalau ada, kalau tidak yang terakhir. */
function highlightMatch(t: EnrichedTournament): BracketMatch | null {
  const played = t.matches.filter((m) => m.score);
  if (played.length === 0) return null;
  return played[played.length - 1];
}

/** Status lunas satu peserta dari iuran turnamen — patungan dicatat per orang, bukan per partai. */
function feePaid(t: EnrichedTournament, name: string): boolean {
  const n = name.trim().toLowerCase();
  return t.fees.find((f) => f.name.trim().toLowerCase() === n)?.paid ?? false;
}

/** Baris skor ditumpuk 2 — niru SideRow bagan: pemenang ditonjolkan, kalah pudar. Tiap kolom = 1 game. */
function ScoreRows({ match }: { match: BracketMatch }) {
  if (!match.score) return null;
  const rows = [
    { side: match.a, scores: match.score.games.map((g) => g.a), isWinner: match.winner === "a" },
    { side: match.b, scores: match.score.games.map((g) => g.b), isWinner: match.winner === "b" },
  ];
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line">
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5",
            i === 1 && "border-t border-line",
            r.isWinner ? "bg-gold/12" : "opacity-55",
          )}
        >
          <span
            className={cn("h-4 w-0.5 shrink-0 rounded-full", r.isWinner ? "bg-gold" : "bg-line-strong")}
            aria-hidden
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12px]",
              r.isWinner ? "font-extrabold text-ink" : "font-semibold text-ink-soft",
            )}
          >
            {pairLabel(r.side.pair) || "—"}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {r.scores.map((s, gi) => (
              <span
                key={gi}
                className={cn(
                  "tabular text-right font-mono text-[12px]",
                  r.isWinner ? "font-bold text-gold" : "text-ink-faint",
                )}
              >
                {s}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Chip status lunas satu pemain — sama gaya persis dengan CourtSide di GameCard. */
function PlayerChip({ t, name }: { t: EnrichedTournament; name: string }) {
  const paid = feePaid(t, name);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5",
        paid ? "border-paid/40 bg-paid/10 text-paid" : "border-owe/40 bg-owe/10 text-owe",
      )}
    >
      <KIcon name={paid ? "checkCircle" : "clock"} className="size-[15px] shrink-0" />
      <span className="truncate text-sm font-semibold leading-tight text-ink">{name || "—"}</span>
    </div>
  );
}

/** Kotak lapangan mini partai penentu — status lunas per pemain (bukan skor), niru court GameCard. */
function MatchCourt({ t, match }: { t: EnrichedTournament; match: BracketMatch }) {
  if (!match.a.pair || !match.b.pair) return null;
  return (
    <div className="court-surface relative mt-2.5 overflow-visible rounded-xl border border-court/20 p-2">
      <div className="court-net pointer-events-none absolute inset-y-4 left-1/2 z-0 w-[2px] -translate-x-1/2" />
      <span className="font-display pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-court/30 bg-surface px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-court shadow-sm">
        VS
      </span>
      <div className="relative z-[1] grid grid-cols-2 gap-x-1">
        <div className="flex min-w-0 flex-col gap-1.5 pr-3.5">
          <PlayerChip t={t} name={match.a.pair.a} />
          <PlayerChip t={t} name={match.a.pair.b} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 pl-3.5">
          <PlayerChip t={t} name={match.b.pair.a} />
          <PlayerChip t={t} name={match.b.pair.b} />
        </div>
      </div>
    </div>
  );
}

export function TournamentHistoryCard({
  tournament,
  today,
}: {
  tournament: EnrichedTournament;
  today: string;
}) {
  const t = tournament;
  const status = tournamentStatus(t, today);
  const meta = STATUS_META[status];
  const highlight = highlightMatch(t);

  return (
    <Link
      href={`/turnamen/${t.id}`}
      className="animate-rise block overflow-hidden rounded-xl2 border border-gold/40 shadow-card transition active:scale-[0.99]"
    >
      {/* Pita atas jadi penanda visual "ini turnamen, bukan main biasa" */}
      <div className="flex items-center gap-1.5 bg-gold/12 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-gold">
        <KIcon name="trophy" className="size-3.5" />
        Turnamen
        <span className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal">
          <KIcon name={meta.icon} className="size-3" />
          {meta.label}
        </span>
      </div>

      <div className="bg-surface p-3.5">
        <p className="font-display truncate text-[0.95rem] font-bold text-ink">{t.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <KIcon name="calendar" className="size-3" /> {fmtDateRange(t.date, t.endDate)}
          </span>
          <span className="inline-flex items-center gap-1">
            <KIcon name={t.format === "knockout" ? "trophy" : "chart"} className="size-3" />
            {t.format === "knockout" ? "Gugur" : "Round robin"} · {t.size} pasang
          </span>
          <span className="inline-flex items-center gap-1">
            <KIcon name="racket" className="size-3" /> {t.playedCount}/{t.totalCount} partai
          </span>
        </p>

        {t.champion ? (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-paid/30 bg-paid/8 px-2.5 py-2">
            <KIcon name="trophy" className="size-4 shrink-0 text-paid" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                Juara
              </span>
              <span className="block truncate text-sm font-extrabold text-ink">
                {pairLabel(t.champion)}
              </span>
            </span>
          </div>
        ) : null}

        {highlight ? (
          <>
            <p className="mt-2.5 px-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              {matchTitle(t, highlight)}
            </p>
            <ScoreRows match={highlight} />
            <MatchCourt t={t} match={highlight} />
          </>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <KIcon name="shuttle" className="size-3.5" /> {t.cost.kokCount} kok
            {t.cost.kokCount ? ` · ${fmt(t.cost.kokTotal)}` : ""}
          </span>
          {t.fee > 0 ? (
            t.cost.unpaidCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-owe">
                <KIcon name="alert" className="size-3.5" /> {t.cost.unpaidCount} belum patungan
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-paid">
                <KIcon name="checkCircle" className="size-3.5" /> Patungan lunas
              </span>
            )
          ) : null}
        </div>
      </div>
    </Link>
  );
}
