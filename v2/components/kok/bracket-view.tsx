"use client";

// Bagan gugur. Kolom = babak, digulir horizontal di layar sempit. Garis
// penghubung digambar pakai elemen absolut di celah antar kolom: tiap dua
// pertandingan yang bertemu dibungkus satu wrapper `justify-around`, jadi
// pusatnya jatuh di 25% & 75% tinggi wrapper — persis titik sambung garisnya.

import { pairLabel } from "@/lib/domain/tournament";
import type { Bracket, BracketMatch, BracketSide } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { KIcon } from "@/components/kok/icons";
import { isPlayable, sideLabel } from "@/components/kok/match-dialog";

const COL_GAP = 28; // px — celah antar kolom, sekaligus lebar area garis
const STUB = COL_GAP / 2;

function SideRow({
  side,
  scores,
  isWinner,
  decided,
}: {
  side: BracketSide;
  /** Skor sisi ini per game (kosong = belum dimainkan). */
  scores: number[];
  isWinner: boolean;
  decided: boolean;
}) {
  const { text, muted } = sideLabel(side);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5",
        isWinner && "bg-paid/10",
        decided && !isWinner && "opacity-55",
      )}
    >
      <span
        className={cn("h-4 w-0.5 shrink-0 rounded-full", isWinner ? "bg-paid" : "bg-line-strong")}
        aria-hidden
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[12px] leading-tight",
          muted
            ? "italic text-ink-faint"
            : isWinner
              ? "font-extrabold text-ink"
              : "font-semibold text-ink-soft",
        )}
        title={muted ? undefined : text}
      >
        {text}
      </span>
      {scores.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          {scores.map((s, i) => (
            <span
              key={i}
              className={cn(
                "tabular w-4 text-right font-mono text-[12px]",
                isWinner ? "font-bold text-paid" : "text-ink-faint",
              )}
            >
              {s}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function MatchBox({
  match,
  editable,
  onOpen,
}: {
  match: BracketMatch;
  editable: boolean;
  onOpen: (m: BracketMatch) => void;
}) {
  const decided = match.winner !== null;
  const playable = isPlayable(match);
  // Read-only tetap bisa dibuka kalau ada kok/skor buat dilihat.
  const clickable = playable && (editable || match.koks.length > 0);
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
        "block w-full overflow-hidden rounded-xl border bg-surface text-left shadow-card transition",
        match.autoWin ? "border-dashed border-line-strong" : "border-line",
        clickable && "hover:border-court/50 active:scale-[0.98]",
      )}
    >
      <div className="divide-y divide-line">
        <SideRow
          side={match.a}
          scores={match.score?.games.map((g) => g.a) ?? []}
          isWinner={match.winner === "a"}
          decided={decided}
        />
        <SideRow
          side={match.b}
          scores={match.score?.games.map((g) => g.b) ?? []}
          isWinner={match.winner === "b"}
          decided={decided}
        />
      </div>
      {playable && (match.koks.length > 0 || editable) ? (
        <div className="flex items-center justify-center gap-1 border-t border-line bg-surface-2/60 py-1 text-[10px] font-bold uppercase tracking-wide">
          {match.koks.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-ink-soft">
              <KIcon name="shuttle" className="size-3" /> {match.koks.length} kok
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-court">
              <KIcon name="pencil" className="size-3" /> {match.score ? "Ubah" : "Isi skor & kok"}
            </span>
          )}
        </div>
      ) : null}
    </Tag>
  );
}

/** Bungkus dua pertandingan yang bertemu di babak berikutnya + garis penghubungnya. */
function MatchPair({
  matches,
  editable,
  onOpen,
  showConnector,
}: {
  matches: BracketMatch[];
  editable: boolean;
  onOpen: (m: BracketMatch) => void;
  showConnector: boolean;
}) {
  const single = matches.length === 1;
  return (
    <div className="relative flex flex-1 flex-col justify-around gap-3">
      {matches.map((m) => (
        <MatchBox key={m.id} match={m} editable={editable} onOpen={onOpen} />
      ))}
      {showConnector ? (
        single ? (
          <span
            className="absolute top-1/2 h-px bg-line-strong"
            style={{ right: -STUB, width: STUB }}
            aria-hidden
          />
        ) : (
          <>
            <span
              className="absolute top-1/4 h-px bg-line-strong"
              style={{ right: -STUB, width: STUB }}
              aria-hidden
            />
            <span
              className="absolute top-3/4 h-px bg-line-strong"
              style={{ right: -STUB, width: STUB }}
              aria-hidden
            />
            <span
              className="absolute h-1/2 w-px bg-line-strong"
              style={{ right: -STUB, top: "25%" }}
              aria-hidden
            />
            <span
              className="absolute top-1/2 h-px bg-line-strong"
              style={{ right: -COL_GAP, width: STUB }}
              aria-hidden
            />
          </>
        )
      ) : null}
    </div>
  );
}

function chunkPairs(matches: BracketMatch[]): BracketMatch[][] {
  const out: BracketMatch[][] = [];
  for (let i = 0; i < matches.length; i += 2) out.push(matches.slice(i, i + 2));
  return out;
}

export function BracketView({
  bracket,
  editable,
  onOpenMatch,
}: {
  bracket: Bracket;
  editable: boolean;
  onOpenMatch: (m: BracketMatch) => void;
}) {
  const lastRound = bracket.rounds.length - 1;

  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2">
      <div className="flex items-stretch" style={{ gap: COL_GAP, minHeight: 260 }}>
        {bracket.rounds.map((round) => (
          <div key={round.round} className="flex w-[188px] shrink-0 flex-col">
            <p className="mb-2 text-center text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
              {round.label}
            </p>
            <div className="flex flex-1 flex-col justify-around">
              {chunkPairs(round.matches).map((group) => (
                <MatchPair
                  key={group[0].id}
                  matches={group}
                  editable={editable}
                  onOpen={onOpenMatch}
                  showConnector={round.round < lastRound}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex w-[188px] shrink-0 flex-col">
          <p className="mb-2 text-center text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
            Juara
          </p>
          <div className="flex flex-1 flex-col justify-center">
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-3 shadow-card",
                bracket.champion
                  ? "border-paid/40 bg-paid/10"
                  : "border-dashed border-line-strong bg-surface-2",
              )}
            >
              <KIcon
                name="trophy"
                className={cn("size-5 shrink-0", bracket.champion ? "text-paid" : "text-ink-faint")}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  bracket.champion ? "font-extrabold text-ink" : "italic text-ink-faint",
                )}
              >
                {bracket.champion ? pairLabel(bracket.champion) : "Belum ada"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
