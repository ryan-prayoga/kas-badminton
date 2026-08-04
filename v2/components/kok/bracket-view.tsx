"use client";

// Bagan gugur. Kolom = babak, digulir horizontal di layar sempit. Garis
// penghubung digambar pakai elemen absolut di celah antar kolom: tiap dua
// pertandingan yang bertemu dibungkus satu wrapper `justify-around`, jadi
// pusatnya jatuh di 25% & 75% tinggi wrapper — persis titik sambung garisnya.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { matchTitle, maxGames, pairLabel, SCORE_FORMATS } from "@/lib/domain/tournament";
import type {
  Bracket,
  BracketMatch,
  BracketSide,
  KokType,
  MatchScore,
  ScoreFormat,
  TournamentSize,
} from "@/lib/domain/types";
import { safeAction } from "@/lib/action-result";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addTournamentKoksAction,
  removeTournamentKokAction,
  setMatchScoreAction,
} from "@/server/actions/tournaments";
import { KIcon } from "@/components/kok/icons";
import {
  defaultKokDate,
  KokDateField,
  KokLinesEditor,
  kokLinesToKoks,
  newKokLine,
  totalKokFromLines,
  type KokLine,
} from "@/components/kok/kok-lines";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COL_GAP = 28; // px — celah antar kolom, sekaligus lebar area garis
const STUB = COL_GAP / 2;

function sideLabel(side: BracketSide): { text: string; muted: boolean } {
  if (side.bye) return { text: "BYE", muted: true };
  const label = pairLabel(side.pair);
  if (!label) return { text: "Menunggu", muted: true };
  return { text: label, muted: false };
}

/** Partai bisa diisi skor/kok hanya kalau dua sisinya sudah jelas dan bukan BYE. */
function isPlayable(m: BracketMatch): boolean {
  return !m.a.bye && !m.b.bye && !!m.a.pair && !!m.b.pair;
}

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
        ? { type: "button" as const, onClick: () => onOpen(match), "aria-label": "Detail pertandingan" }
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

/** Ringkas kok satu partai per jenis+harga — satu partai bisa campur beberapa jenis. */
function groupKoks(koks: BracketMatch["koks"]) {
  const map = new Map<string, { name: string; price: number; ids: string[] }>();
  for (const k of koks) {
    const key = `${k.typeId ?? "custom"}-${k.pricePerPerson}`;
    const g = map.get(key) ?? { name: k.typeName || "Tanpa jenis", price: k.pricePerPerson, ids: [] };
    g.ids.push(k.id);
    map.set(key, g);
  }
  return [...map.values()];
}

function emptyGames() {
  return [
    { a: "", b: "" },
    { a: "", b: "" },
    { a: "", b: "" },
  ];
}

export function BracketView({
  tournamentId,
  bracket,
  size,
  editable,
  kokTypes,
  defaultPrice,
  defaultFormat,
  startDate,
  endDate,
}: {
  tournamentId: string;
  bracket: Bracket;
  size: TournamentSize;
  editable: boolean;
  kokTypes: KokType[];
  defaultPrice: number;
  /** Format skor bawaan turnamen; tiap partai tetap bisa dipindah. */
  defaultFormat: ScoreFormat;
  startDate: string;
  endDate: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [format, setFormat] = useState<ScoreFormat>(defaultFormat);
  // Selalu 3 baris di state; yang terpakai tergantung format, baris kosong dibuang saat simpan.
  const [games, setGames] = useState<{ a: string; b: string }[]>(emptyGames);
  const [addingKok, setAddingKok] = useState(false);
  const [lines, setLines] = useState<KokLine[]>([]);
  const [kokDate, setKokDate] = useState(() => defaultKokDate(startDate, endDate));
  const [pending, start] = useTransition();

  const active = useMemo(() => kokTypes.filter((t) => t.active), [kokTypes]);

  // Ambil ulang dari `bracket` tiap render — biar isi dialog ikut update
  // setelah tambah/hapus kok tanpa perlu tutup-buka.
  const editing = useMemo(
    () => bracket.rounds.flatMap((r) => r.matches).find((m) => m.id === openId) ?? null,
    [bracket, openId],
  );

  const open = (m: BracketMatch) => {
    setOpenId(m.id);
    setFormat(m.score?.format ?? defaultFormat);
    const next = emptyGames();
    m.score?.games.forEach((g, i) => {
      next[i] = { a: String(g.a), b: String(g.b) };
    });
    setGames(next);
    setAddingKok(false);
    setLines([newKokLine(active, defaultPrice)]);
    setKokDate(defaultKokDate(startDate, endDate));
  };

  const setGame =(i: number, side: "a" | "b", raw: string) => {
    const v = raw.replace(/[^\d]/g, "").slice(0, 2);
    setGames((gs) => gs.map((g, idx) => (idx === i ? { ...g, [side]: v } : g)));
  };

  const close = () => {
    setOpenId(null);
    setAddingKok(false);
  };

  const saveScore = (clear: boolean) => {
    if (!editing) return;
    let score: MatchScore | null = null;

    if (!clear) {
      const filled = games
        .slice(0, maxGames(format))
        .map((g) => ({ a: Number(g.a) || 0, b: Number(g.b) || 0 }))
        .filter((g) => g.a > 0 || g.b > 0);
      if (filled.length === 0) {
        toast.error("Isi skor minimal satu game");
        return;
      }
      if (filled.some((g) => g.a === g.b)) {
        toast.error("Skor game tidak boleh seri");
        return;
      }
      score = { format, games: filled };
    }

    start(async () => {
      const res = await safeAction(() => setMatchScoreAction(tournamentId, editing.id, score));
      if (res.ok) {
        toast.success(clear ? "Skor dihapus" : "Skor disimpan");
        close();
      } else {
        toast.error(res.error);
      }
    });
  };

  const addKoks = () => {
    if (!editing) return;
    const koks = kokLinesToKoks(lines, active, defaultPrice);
    if (koks.length === 0) {
      toast.error("Minimal 1 kok");
      return;
    }
    start(async () => {
      const res = await safeAction(() =>
        addTournamentKoksAction(tournamentId, koks, editing.id, kokDate),
      );
      if (res.ok) {
        toast.success(`${koks.length} kok ditambah ke partai ini`);
        setAddingKok(false);
        setLines([newKokLine(active, defaultPrice)]);
      } else {
        toast.error(res.error);
      }
    });
  };

  const removeKok = (kokId: string) => {
    start(async () => {
      const res = await safeAction(() => removeTournamentKokAction(tournamentId, kokId));
      if (res.ok) toast.success("Kok dihapus, stok dikembalikan");
      else toast.error(res.error);
    });
  };

  const lastRound = bracket.rounds.length - 1;

  return (
    <>
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
                    onOpen={open}
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

      <Dialog open={editing !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[88dvh] max-w-sm flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-display">
              {editing ? matchTitle(editing.round, editing.index, size) : "Pertandingan"}
            </DialogTitle>
            <DialogDescription>
              {editing ? `${sideLabel(editing.a).text} vs ${sideLabel(editing.b).text}` : ""}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Skor</p>

                {editable ? (
                  <div className="flex gap-1.5">
                    {SCORE_FORMATS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFormat(f.value)}
                        aria-pressed={format === f.value}
                        className={cn(
                          "flex-1 rounded-xl px-2 py-2 text-center transition",
                          format === f.value
                            ? "bg-court text-white shadow-court"
                            : "bg-surface-2 text-ink-soft hover:bg-court/10 hover:text-court",
                        )}
                      >
                        <span className="block text-sm font-bold">{f.label}</span>
                        <span className="block text-[10px] opacity-80">{f.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-faint">
                    {editing.score?.format === "bo3" ? "Rally 21 · best of 3 game" : "1 game sampai 30"}
                  </p>
                )}

                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="flex items-center gap-2 bg-surface-2/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                    <span className="min-w-0 flex-1">Pasangan</span>
                    {Array.from({ length: maxGames(format) }, (_, i) => (
                      <span key={i} className="w-14 shrink-0 text-center">
                        {maxGames(format) > 1 ? `G${i + 1}` : "Skor"}
                      </span>
                    ))}
                  </div>
                  {(["a", "b"] as const).map((key) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 border-t border-line bg-surface px-2.5 py-2"
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          editing.winner === key ? "font-extrabold text-ink" : "font-semibold text-ink-soft",
                        )}
                      >
                        {sideLabel(editing[key]).text}
                      </span>
                      {Array.from({ length: maxGames(format) }, (_, i) =>
                        editable ? (
                          <Input
                            key={i}
                            inputMode="numeric"
                            value={games[i][key]}
                            onChange={(e) => setGame(i, key, e.target.value)}
                            aria-label={`Game ${i + 1} · skor ${sideLabel(editing[key]).text}`}
                            className="h-11 w-14 shrink-0 rounded-xl text-center font-mono text-base font-bold"
                          />
                        ) : (
                          <span
                            key={i}
                            className="tabular w-14 shrink-0 text-center font-mono text-base font-bold text-ink"
                          >
                            {editing.score?.games[i]?.[key] ?? "—"}
                          </span>
                        ),
                      )}
                    </div>
                  ))}
                </div>

                {format === "bo3" ? (
                  <p className="text-[11px] text-ink-faint">
                    Menang 2 game langsung lolos — game 3 boleh dikosongin.
                    {editing.score
                      ? ` Sementara ${editing.gamesWon.a}–${editing.gamesWon.b}.`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                    Kok partai ini
                  </p>
                  <span className="tabular text-[11px] font-semibold text-ink-soft">
                    {editing.koks.length} kok · {fmt(editing.kokTotal)}
                  </span>
                </div>

                {editing.koks.length === 0 && !addingKok ? (
                  <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-[11px] text-ink-faint">
                    Belum ada kok dicatat di partai ini.
                  </p>
                ) : null}

                {editing.koks.length > 0 ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                    {groupKoks(editing.koks).map((g) => (
                      <li
                        key={`${g.name}-${g.price}`}
                        className="flex items-center gap-2 bg-surface px-3 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {g.name}
                          </span>
                          <span className="block text-[11px] text-ink-faint">
                            {g.ids.length} kok · {fmt(g.price * 4)}/kok
                          </span>
                        </span>
                        {editable ? (
                          <button
                            type="button"
                            onClick={() => removeKok(g.ids[g.ids.length - 1])}
                            disabled={pending}
                            aria-label={`Hapus satu kok ${g.name}`}
                            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          >
                            <KIcon name="minus" className="size-4" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {editable ? (
                  addingKok ? (
                    <div className="space-y-2 rounded-xl border border-line p-2.5">
                      <KokDateField
                        value={kokDate}
                        onChange={setKokDate}
                        startDate={startDate}
                        endDate={endDate}
                        id={`kok-date-${editing.id}`}
                      />
                      <KokLinesEditor
                        lines={lines}
                        setLines={setLines}
                        kokTypes={kokTypes}
                        defaultPrice={defaultPrice}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAddingKok(false)}
                          className="h-10 flex-1 rounded-xl border border-line text-sm font-bold text-ink-soft transition active:scale-[0.98]"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={addKoks}
                          disabled={pending || totalKokFromLines(lines) === 0}
                          className="inline-flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
                        >
                          <KIcon name="plus" className="size-4" /> Tambah{" "}
                          {totalKokFromLines(lines)} kok
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setLines([newKokLine(active, defaultPrice)]);
                        setAddingKok(true);
                      }}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-line text-sm font-semibold text-court transition active:scale-[0.98]"
                    >
                      <KIcon name="plus" className="size-4" /> Tambah kok partai ini
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ) : null}

          {editable ? (
            <div className="flex shrink-0 gap-2 pt-1">
              {editing?.score ? (
                <button
                  type="button"
                  onClick={() => saveScore(true)}
                  disabled={pending}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line text-sm font-bold text-ink-soft transition active:scale-[0.98] disabled:opacity-60"
                >
                  <KIcon name="trash" className="size-4" /> Hapus skor
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => saveScore(false)}
                disabled={pending}
                className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
              >
                <KIcon name="save" className="size-4" /> Simpan skor
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
