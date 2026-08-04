"use client";

// Round robin: klasemen + daftar partai. Tidak ada bagan — juara diambil dari
// peringkat 1 setelah semua partai selesai.

import { pairLabel } from "@/lib/domain/tournament";
import type { BracketMatch, RoundRobin } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { KIcon } from "@/components/kok/icons";
import { isPlayable, sideLabel } from "@/components/kok/match-dialog";

function ScoreCell({ scores, isWinner }: { scores: number[]; isWinner: boolean }) {
  if (scores.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {scores.map((s, i) => (
        <span
          key={i}
          className={cn(
            "tabular w-5 text-right font-mono text-[12px]",
            isWinner ? "font-bold text-paid" : "text-ink-faint",
          )}
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function MatchRow({
  match,
  editable,
  onOpen,
}: {
  match: BracketMatch;
  editable: boolean;
  onOpen: (m: BracketMatch) => void;
}) {
  const playable = isPlayable(match);
  const clickable = playable && (editable || match.koks.length > 0 || !!match.score);
  const Tag = clickable ? "button" : "div";

  return (
    <Tag
      {...(clickable
        ? {
            type: "button" as const,
            onClick: () => onOpen(match),
            "aria-label": "Detail pertandingan",
          }
        : {})}
      className={cn(
        "block w-full bg-surface px-3 py-2 text-left odd:bg-surface-2/60",
        clickable && "transition active:scale-[0.99]",
      )}
    >
      {(["a", "b"] as const).map((key) => {
        const isWinner = match.winner === key;
        const { text, muted } = sideLabel(match[key]);
        return (
          <div key={key} className="flex items-center gap-2 py-0.5">
            <span
              className={cn("h-3.5 w-0.5 shrink-0 rounded-full", isWinner ? "bg-paid" : "bg-line-strong")}
              aria-hidden
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                muted
                  ? "italic text-ink-faint"
                  : isWinner
                    ? "font-extrabold text-ink"
                    : "font-semibold text-ink-soft",
              )}
            >
              {text}
            </span>
            <ScoreCell
              scores={match.score?.games.map((g) => g[key]) ?? []}
              isWinner={isWinner}
            />
          </div>
        );
      })}

      {playable ? (
        <div className="mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
          {match.koks.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-ink-faint">
              <KIcon name="shuttle" className="size-3" /> {match.koks.length} kok
            </span>
          ) : null}
          {editable ? (
            <span className="inline-flex items-center gap-1 text-court">
              <KIcon name="pencil" className="size-3" />
              {match.score ? "Ubah" : "Isi skor & kok"}
            </span>
          ) : null}
        </div>
      ) : null}
    </Tag>
  );
}

export function RoundRobinView({
  roundRobin,
  editable,
  onOpenMatch,
}: {
  roundRobin: RoundRobin;
  editable: boolean;
  onOpenMatch: (m: BracketMatch) => void;
}) {
  const { standings, matches, champion, playedCount, totalCount } = roundRobin;
  // Partai dengan slot kosong tidak bisa dimainkan — sembunyikan dari daftar.
  const visible = matches.filter((m) => m.a.pair && m.b.pair);

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2.5",
          champion ? "border-paid/40 bg-paid/10" : "border-dashed border-line-strong bg-surface-2",
        )}
      >
        <KIcon
          name="trophy"
          className={cn("size-5 shrink-0", champion ? "text-paid" : "text-ink-faint")}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
            Juara
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              champion ? "font-extrabold text-ink" : "italic text-ink-faint",
            )}
          >
            {champion ? pairLabel(champion) : `Belum ada · ${playedCount}/${totalCount} partai`}
          </span>
        </span>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
          Klasemen
        </p>
        {standings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-xs text-ink-faint">
            Belum ada pasangan.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center gap-2 bg-surface-2/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              <span className="w-4 shrink-0 text-center">#</span>
              <span className="min-w-0 flex-1">Pasangan</span>
              <span className="w-7 shrink-0 text-center">M</span>
              <span className="w-7 shrink-0 text-center">K</span>
              <span className="w-10 shrink-0 text-right">Sel.</span>
            </div>
            {standings.map((row, i) => (
              <div
                key={row.pair.id}
                className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2 odd:bg-surface-2/40"
              >
                <span
                  className={cn(
                    "font-display tabular w-4 shrink-0 text-center text-sm font-bold",
                    i === 0 && row.played > 0 ? "text-paid" : "text-ink-faint",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {pairLabel(row.pair)}
                  </span>
                  <span className="block text-[10px] text-ink-faint">
                    {row.played} main · {row.pointsFor}–{row.pointsAgainst} poin
                  </span>
                </span>
                <span className="tabular w-7 shrink-0 text-center font-mono text-sm font-bold text-paid">
                  {row.won}
                </span>
                <span className="tabular w-7 shrink-0 text-center font-mono text-sm text-ink-soft">
                  {row.lost}
                </span>
                <span
                  className={cn(
                    "tabular w-10 shrink-0 text-right font-mono text-sm font-semibold",
                    row.diff > 0 ? "text-paid" : row.diff < 0 ? "text-owe" : "text-ink-faint",
                  )}
                >
                  {row.diff > 0 ? `+${row.diff}` : row.diff}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
          Partai · {playedCount}/{totalCount} selesai
        </p>
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-xs text-ink-faint">
            Belum ada partai — isi minimal 2 pasangan.
          </p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {visible.map((m) => (
              <MatchRow key={m.id} match={m} editable={editable} onOpen={onOpenMatch} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
