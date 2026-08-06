"use client";

// Dialog satu partai: skor (format bisa diganti per partai) + kok yang dipakai
// di partai itu. Dipakai bareng bagan gugur dan daftar partai round robin.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { matchTitle, maxGames, pairLabel, SCORE_FORMATS } from "@/lib/domain/tournament";
import type {
  BracketMatch,
  BracketSide,
  EnrichedTournament,
  KokType,
  MatchScore,
  ScoreFormat,
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

export function sideLabel(side: BracketSide): { text: string; muted: boolean } {
  if (side.bye) return { text: "BYE", muted: true };
  const label = pairLabel(side.pair);
  if (!label) return { text: "Menunggu", muted: true };
  return { text: label, muted: false };
}

/** Partai bisa diisi skor/kok hanya kalau dua sisinya sudah jelas dan bukan BYE. */
export function isPlayable(m: BracketMatch): boolean {
  return !m.a.bye && !m.b.bye && !!m.a.pair && !!m.b.pair;
}

function emptyGames() {
  return [
    { a: "", b: "" },
    { a: "", b: "" },
    { a: "", b: "" },
  ];
}

/** Ringkas kok satu partai per jenis+harga — satu partai bisa campur beberapa jenis. */
function groupKoks(koks: BracketMatch["koks"]) {
  const map = new Map<string, { name: string; price: number; ids: string[] }>();
  for (const k of koks) {
    const key = `${k.typeId ?? "custom"}-${k.pricePerPerson}`;
    const g = map.get(key) ?? {
      name: k.typeName || "Tanpa jenis",
      price: k.pricePerPerson,
      ids: [],
    };
    g.ids.push(k.id);
    map.set(key, g);
  }
  return [...map.values()];
}

export function MatchDialog({
  tournament,
  matchId,
  onClose,
  editable,
  kokTypes,
  defaultPrice,
  initialMode = "score",
}: {
  tournament: EnrichedTournament;
  /** Id partai yang dibuka; null = dialog tertutup. */
  matchId: string | null;
  onClose: () => void;
  editable: boolean;
  kokTypes: KokType[];
  defaultPrice: number;
  /** "kok" = langsung buka form tambah kok (dari tombol + di kartu Riwayat). */
  initialMode?: "score" | "kok";
}) {
  const t = tournament;
  const [format, setFormat] = useState<ScoreFormat>(t.scoreFormat);
  const [games, setGames] = useState<{ a: string; b: string }[]>(emptyGames);
  const [playedDate, setPlayedDate] = useState(() => defaultKokDate(t.date, t.endDate));
  const [addingKok, setAddingKok] = useState(false);
  const [lines, setLines] = useState<KokLine[]>([]);
  const [kokDate, setKokDate] = useState(() => defaultKokDate(t.date, t.endDate));
  const [pending, start] = useTransition();

  const active = useMemo(() => kokTypes.filter((x) => x.active), [kokTypes]);

  // Ambil ulang dari data terbaru tiap render — isi dialog ikut update setelah
  // tambah/hapus kok tanpa perlu tutup-buka.
  const match = useMemo(
    () => t.matches.find((m) => m.id === matchId) ?? null,
    [t.matches, matchId],
  );

  // Isi form saat partai yang dibuka berganti — pola reset-saat-render (sama
  // seperti GameCard). Sengaja bukan efek: ketikan tidak boleh kereset tiap
  // kali data turnamen ter-refresh, cuma saat pindah partai. `initialMode` ikut
  // jadi kunci reset biar buka ulang partai yang sama dgn mode beda (skor ↔ kok) tetap kepicu.
  const resetKey = matchId ? `${matchId}:${initialMode}` : null;
  const [formFor, setFormFor] = useState<string | null>(resetKey);
  if (formFor !== resetKey) {
    setFormFor(resetKey);
    const m = matchId ? t.matches.find((x) => x.id === matchId) : null;
    setFormat(m?.score?.format ?? t.scoreFormat);
    const next = emptyGames();
    m?.score?.games.forEach((g, i) => {
      next[i] = { a: String(g.a), b: String(g.b) };
    });
    setGames(next);
    setPlayedDate(m?.score?.playedAt || defaultKokDate(t.date, t.endDate));
    setAddingKok(editable && initialMode === "kok");
    setLines([newKokLine(active, defaultPrice)]);
    setKokDate(defaultKokDate(t.date, t.endDate));
  }

  const setGame = (i: number, side: "a" | "b", raw: string) => {
    const v = raw.replace(/[^\d]/g, "").slice(0, 2);
    setGames((gs) => gs.map((g, idx) => (idx === i ? { ...g, [side]: v } : g)));
  };

  const saveScore = (clear: boolean) => {
    if (!match) return;
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
      score = { format, games: filled, playedAt: playedDate };
    }

    start(async () => {
      const res = await safeAction(() => setMatchScoreAction(t.id, match.id, score));
      if (res.ok) {
        toast.success(clear ? "Skor dihapus" : "Skor disimpan");
        onClose();
      } else {
        toast.error(res.error);
      }
    });
  };

  const addKoks = () => {
    if (!match) return;
    const koks = kokLinesToKoks(lines, active, defaultPrice);
    if (koks.length === 0) {
      toast.error("Minimal 1 kok");
      return;
    }
    start(async () => {
      const res = await safeAction(() => addTournamentKoksAction(t.id, koks, match.id, kokDate));
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
      const res = await safeAction(() => removeTournamentKokAction(t.id, kokId));
      if (res.ok) toast.success("Kok dihapus, stok dikembalikan");
      else toast.error(res.error);
    });
  };

  return (
    <Dialog open={match !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[94dvh] max-w-sm flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-display">
            {match ? matchTitle(t, match) : "Pertandingan"}
          </DialogTitle>
          <DialogDescription>
            {match ? `${sideLabel(match.a).text} vs ${sideLabel(match.b).text}` : ""}
          </DialogDescription>
        </DialogHeader>

        {match ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Skor</p>

              {editable ? (
                <KokDateField
                  value={playedDate}
                  onChange={setPlayedDate}
                  startDate={t.date}
                  endDate={t.endDate}
                  id={`match-date-${match.id}`}
                  label="Tanggal partai"
                />
              ) : null}

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
                  {match.score?.format === "bo3" ? "Rally 21 · best of 3 game" : "1 game sampai 30"}
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
                        match.winner === key
                          ? "font-extrabold text-ink"
                          : "font-semibold text-ink-soft",
                      )}
                    >
                      {sideLabel(match[key]).text}
                    </span>
                    {Array.from({ length: maxGames(format) }, (_, i) =>
                      editable ? (
                        <Input
                          key={i}
                          inputMode="numeric"
                          value={games[i][key]}
                          onChange={(e) => setGame(i, key, e.target.value)}
                          aria-label={`Game ${i + 1} · skor ${sideLabel(match[key]).text}`}
                          className="h-11 w-14 shrink-0 rounded-xl text-center font-mono text-base font-bold"
                        />
                      ) : (
                        <span
                          key={i}
                          className="tabular w-14 shrink-0 text-center font-mono text-base font-bold text-ink"
                        >
                          {match.score?.games[i]?.[key] ?? "—"}
                        </span>
                      ),
                    )}
                  </div>
                ))}
              </div>

              {format === "bo3" ? (
                <p className="text-[11px] text-ink-faint">
                  Menang 2 game langsung lolos — game 3 boleh dikosongin.
                  {match.score ? ` Sementara ${match.gamesWon.a}–${match.gamesWon.b}.` : ""}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                  Kok partai ini
                </p>
                <span className="tabular text-[11px] font-semibold text-ink-soft">
                  {match.koks.length} kok · {fmt(match.kokTotal)}
                </span>
              </div>

              {match.koks.length === 0 && !addingKok ? (
                <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-[11px] text-ink-faint">
                  Belum ada kok dicatat di partai ini.
                </p>
              ) : null}

              {match.koks.length > 0 ? (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {groupKoks(match.koks).map((g) => (
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
                      startDate={t.date}
                      endDate={t.endDate}
                      id={`kok-date-${match.id}`}
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
                        <KIcon name="plus" className="size-4" /> Tambah {totalKokFromLines(lines)}{" "}
                        kok
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setLines([newKokLine(active, defaultPrice)]);
                      setKokDate(defaultKokDate(t.date, t.endDate));
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
            {match?.score ? (
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
  );
}
