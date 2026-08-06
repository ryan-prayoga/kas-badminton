"use client";

// Bagan gugur. Kolom = babak, digulir horizontal di layar sempit. Posisi tiap
// box DIUKUR dari DOM (bukan ditebak pakai persentase CSS) — box babak
// berikutnya ditaruh persis di tengah dua box sumbernya berdasarkan tinggi
// asli hasil ukur, jadi garis penghubung selalu nyambung pas walau tinggi box
// beda-beda (baris "isi kok" cuma muncul di sebagian box, BYE lebih pendek).

import { useCallback, useLayoutEffect, useRef, useState, type Ref } from "react";
import { pairLabel } from "@/lib/domain/tournament";
import type { Bracket, BracketMatch, BracketSide } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { KIcon } from "@/components/kok/icons";
import { isPlayable, sideLabel } from "@/components/kok/match-dialog";

const COL_WIDTH = 188; // px
const COL_GAP = 28; // px — celah antar kolom, sekaligus lebar area garis
const ROW_GAP = 12; // px — jarak antar box di babak pertama

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
  const displayText = text.replace(/ \/ /g, " & ");
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 px-2 py-1.5",
        isWinner && "bg-paid/10",
        decided && !isWinner && "opacity-55",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-center text-[12px] leading-tight",
          muted
            ? "italic text-ink-faint"
            : isWinner
              ? "font-extrabold text-ink"
              : "font-semibold text-ink-soft",
        )}
        title={muted ? undefined : text}
      >
        {displayText}
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

type Pos = { top: number; height: number };
type Layout = { positions: Map<string, Pos>; champion: Pos | null; height: number; headerOffset: number };

/** Ukur tinggi asli tiap box dari DOM lalu hitung posisi vertikalnya: babak
 *  pertama numpuk rapat (gap tetap), babak berikutnya ditaruh persis di
 *  tengah dua box sumbernya — garis penghubung otomatis nyambung pas. */
function useBracketLayout(bracket: Bracket) {
  const boxRefs = useRef(new Map<string, HTMLElement>());
  const champRef = useRef<HTMLElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const contentTopRef = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  const recompute = useCallback(() => {
    if (bracket.rounds.length === 0) {
      setLayout({ positions: new Map(), champion: null, height: 96, headerOffset: 0 });
      return;
    }

    const centers: number[][] = [];
    const heights: number[][] = [];

    const round0 = bracket.rounds[0];
    const h0 = round0.matches.map((m) => boxRefs.current.get(m.id)?.offsetHeight ?? 0);
    if (h0.some((h) => h === 0)) return; // belum ke-mount semua box, coba lagi lain waktu
    let cursor = 0;
    const c0 = h0.map((h) => {
      const c = cursor + h / 2;
      cursor += h + ROW_GAP;
      return c;
    });
    centers.push(c0);
    heights.push(h0);

    for (let r = 1; r < bracket.rounds.length; r++) {
      const round = bracket.rounds[r];
      const prev = centers[r - 1];
      const hs = round.matches.map((m) => boxRefs.current.get(m.id)?.offsetHeight ?? 0);
      if (hs.some((h) => h === 0)) return;
      const cs = round.matches.map((_, i) => {
        const a = prev[2 * i];
        const b = prev[2 * i + 1];
        return b !== undefined ? (a + b) / 2 : a;
      });
      centers.push(cs);
      heights.push(hs);
    }

    const positions = new Map<string, Pos>();
    bracket.rounds.forEach((round, r) => {
      round.matches.forEach((m, i) => {
        positions.set(m.id, { top: centers[r][i] - heights[r][i] / 2, height: heights[r][i] });
      });
    });

    const lastRound = centers.length - 1;
    const champHeight = champRef.current?.offsetHeight ?? 0;
    const champion: Pos | null =
      champHeight > 0 && centers[lastRound]?.[0] !== undefined
        ? { top: centers[lastRound][0] - champHeight / 2, height: champHeight }
        : null;

    const bottoms = bracket.rounds.flatMap((round, r) =>
      round.matches.map((_, i) => centers[r][i] + heights[r][i] / 2),
    );
    if (champion) bottoms.push(champion.top + champion.height);
    const height = Math.max(0, ...bottoms);

    const headerOffset =
      contentTopRef.current && rowRef.current
        ? contentTopRef.current.getBoundingClientRect().top - rowRef.current.getBoundingClientRect().top
        : 0;

    setLayout({ positions, champion, height, headerOffset });
  }, [bracket]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useLayoutEffect(() => {
    const els = [...boxRefs.current.values(), champRef.current].filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new ResizeObserver(() => recompute());
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [recompute, layout]);

  return { boxRefs, champRef, rowRef, contentTopRef, layout };
}

/** Garis penghubung antar babak, dihitung dari posisi box hasil ukur DOM. */
function Connectors({ bracket, layout }: { bracket: Bracket; layout: Layout }) {
  const centerOf = (id: string) => {
    const p = layout.positions.get(id);
    return p ? p.top + p.height / 2 : null;
  };
  const colLeft = (r: number) => r * (COL_WIDTH + COL_GAP);
  const colRight = (r: number) => colLeft(r) + COL_WIDTH;

  type Seg = { x1: number; y1: number; x2: number; y2: number };
  const segs: Seg[] = [];

  bracket.rounds.forEach((round, r) => {
    if (r === bracket.rounds.length - 1) return;
    const next = bracket.rounds[r + 1];
    for (let i = 0; i < round.matches.length; i += 2) {
      const a = round.matches[i];
      const b = round.matches[i + 1] as BracketMatch | undefined;
      const target = next?.matches[i / 2];
      if (!a || !target) continue;
      const yA = centerOf(a.id);
      const yTarget = centerOf(target.id);
      if (yA === null || yTarget === null) continue;
      const xSrc = colRight(r);
      const xGap = xSrc + COL_GAP / 2;
      const xDst = colLeft(r + 1);

      segs.push({ x1: xSrc, y1: yA, x2: xGap, y2: yA });
      if (b) {
        const yB = centerOf(b.id);
        if (yB !== null) segs.push({ x1: xSrc, y1: yB, x2: xGap, y2: yB }, { x1: xGap, y1: yA, x2: xGap, y2: yB });
      } else if (yA !== yTarget) {
        segs.push({ x1: xGap, y1: yA, x2: xGap, y2: yTarget });
      }
      segs.push({ x1: xGap, y1: yTarget, x2: xDst, y2: yTarget });
    }
  });

  const lastRound = bracket.rounds.length - 1;
  const finalMatch = bracket.rounds[lastRound]?.matches[0];
  if (finalMatch && layout.champion) {
    const yA = centerOf(finalMatch.id);
    const yC = layout.champion.top + layout.champion.height / 2;
    if (yA !== null) {
      const xSrc = colRight(lastRound);
      const xGap = xSrc + COL_GAP / 2;
      const xDst = colLeft(lastRound + 1);
      segs.push({ x1: xSrc, y1: yA, x2: xGap, y2: yA });
      if (yA !== yC) segs.push({ x1: xGap, y1: yA, x2: xGap, y2: yC });
      segs.push({ x1: xGap, y1: yC, x2: xDst, y2: yC });
    }
  }

  return (
    <div
      className="pointer-events-none absolute left-0 w-full"
      style={{ top: layout.headerOffset, height: layout.height }}
      aria-hidden
    >
      {segs.map((s, i) =>
        s.x1 === s.x2 ? (
          <span
            key={i}
            className="absolute w-px bg-line-strong"
            style={{ left: s.x1, top: Math.min(s.y1, s.y2), height: Math.abs(s.y2 - s.y1) }}
          />
        ) : (
          <span
            key={i}
            className="absolute h-px bg-line-strong"
            style={{ top: s.y1, left: Math.min(s.x1, s.x2), width: Math.abs(s.x2 - s.x1) }}
          />
        ),
      )}
    </div>
  );
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
  const { boxRefs, champRef, rowRef, contentTopRef, layout } = useBracketLayout(bracket);
  const ready = layout !== null;

  const setBoxRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) boxRefs.current.set(id, el);
      else boxRefs.current.delete(id);
    },
    [boxRefs],
  );

  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2">
      <div ref={rowRef} className="relative flex items-start" style={{ gap: COL_GAP, minHeight: 260 }}>
        {bracket.rounds.map((round, r) => (
          <div key={round.round} className="w-[188px] shrink-0">
            <p className="mb-2 text-center text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
              {round.label}
            </p>
            <div
              ref={r === 0 ? (contentTopRef as Ref<HTMLDivElement>) : undefined}
              className={cn("relative", !ready && "flex flex-col gap-3")}
              style={ready ? { height: layout.height } : undefined}
            >
              {round.matches.map((m) => {
                const pos = ready ? layout.positions.get(m.id) : undefined;
                return (
                  <div
                    key={m.id}
                    ref={setBoxRef(m.id)}
                    className={ready ? "absolute inset-x-0" : undefined}
                    style={ready && pos ? { top: pos.top } : undefined}
                  >
                    <MatchBox match={m} editable={editable} onOpen={onOpenMatch} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="w-[188px] shrink-0">
          <p className="mb-2 text-center text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-faint">
            Juara
          </p>
          <div
            className={cn("relative", !ready && "flex flex-col justify-center")}
            style={ready ? { height: layout.height } : { minHeight: 200 }}
          >
            <div
              ref={champRef as Ref<HTMLDivElement>}
              className={ready ? "absolute inset-x-0" : undefined}
              style={ready && layout.champion ? { top: layout.champion.top } : undefined}
            >
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

        {ready ? <Connectors bracket={bracket} layout={layout} /> : null}
      </div>
    </div>
  );
}
