"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bracketSize,
  MAX_PAIRS,
  MIN_PAIRS,
  roundRobinMatchCount,
  SCORE_FORMATS,
  TOURNAMENT_FORMATS,
} from "@/lib/domain/tournament";
import type { PlayerRow, ScoreFormat, TournamentFormat } from "@/lib/domain/types";
import { safeAction } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { createTournamentAction } from "@/server/actions/tournaments";
import { buildPhotoMap } from "@/components/kok/avatar";
import { DateField } from "@/components/kok/date-field";
import { KIcon } from "@/components/kok/icons";
import { PlayerNameInput } from "@/components/kok/player-name-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface PairDraft {
  a: string;
  b: string;
}

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function emptyPairs(size: number): PairDraft[] {
  return Array.from({ length: size }, () => ({ a: "", b: "" }));
}

/** Pilihan cepat yang paling sering dipakai; sisanya lewat tombol +/−. */
const SIZE_PRESETS = [4, 8, 16];

export function CreateTournamentSheet({
  players,
  trigger,
}: {
  players: PlayerRow[];
  trigger?: ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const photoMap = useMemo(() => buildPhotoMap(players), [players]);
  const playerNames = players.map((p) => p.name);

  const [name, setName] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [multiDay, setMultiDay] = useState(false);
  const [endDate, setEndDate] = useState(todayLocal());
  const [format, setFormat] = useState<TournamentFormat>("knockout");
  const [size, setSize] = useState(8);
  const [scoreFormat, setScoreFormat] = useState<ScoreFormat>("single");
  const [pairs, setPairs] = useState<PairDraft[]>(() => emptyPairs(8));
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");

  const filledPairs = pairs.filter((p) => p.a.trim() || p.b.trim()).length;
  const participants = useMemo(() => {
    const seen = new Set<string>();
    for (const p of pairs) {
      for (const raw of [p.a, p.b]) {
        const n = raw.trim().replace(/\s+/g, " ");
        if (n) seen.add(n.toLowerCase());
      }
    }
    return seen.size;
  }, [pairs]);

  const slots = bracketSize(size);
  const byeSlots = slots - size;
  const rrMatches = roundRobinMatchCount(size);

  const changeSize = (next: number) => {
    const n = Math.max(MIN_PAIRS, Math.min(MAX_PAIRS, next));
    setSize(n);
    // Pertahankan pasangan yang sudah diketik saat ganti jumlah.
    setPairs((prev) => emptyPairs(n).map((empty, i) => prev[i] ?? empty));
  };

  const setPair = (i: number, patch: Partial<PairDraft>) =>
    setPairs((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const reset = () => {
    setName("");
    setDate(todayLocal());
    setMultiDay(false);
    setEndDate(todayLocal());
    setFormat("knockout");
    setSize(8);
    setScoreFormat("single");
    setPairs(emptyPairs(8));
    setFee("");
    setNotes("");
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error("Isi nama turnamen");
      return;
    }
    if (participants === 0) {
      toast.error("Isi minimal satu pasangan");
      return;
    }
    if (format === "round_robin" && filledPairs < 2) {
      toast.error("Semua lawan semua butuh minimal 2 pasangan terisi");
      return;
    }
    const filled = pairs
      .flatMap((p) => [p.a, p.b])
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    if (new Set(filled).size !== filled.length) {
      toast.error("Ada nama yang dipakai lebih dari sekali");
      return;
    }

    start(async () => {
      const res = await safeAction(() =>
        createTournamentAction({
          name: name.trim(),
          date,
          endDate: multiDay && endDate > date ? endDate : null,
          format,
          size,
          scoreFormat,
          fee: Number(fee) || 0,
          pairs: pairs.map((p) => ({ a: p.a.trim(), b: p.b.trim() })),
          notes: notes.trim() || undefined,
        }),
      );
      if (res.ok) {
        toast.success("Turnamen dibuat");
        setOpen(false);
        reset();
        router.push(`/turnamen/${res.data}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <button
              type="button"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98]"
            >
              <KIcon name="plus" className="size-4" /> Bikin turnamen
            </button>
          )
        }
      />

      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden rounded-t-[1.75rem] border-line pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="shrink-0 pr-12">
          <SheetTitle className="font-display">Bikin turnamen</SheetTitle>
          <SheetDescription>
            Kok ditambah belakangan — per partai atau kok umum, dari halaman turnamennya.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-name">Nama turnamen</Label>
            <Input
              id="t-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tarkam PB Sarjana"
              maxLength={80}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-date">{multiDay ? "Tanggal mulai" : "Tanggal"}</Label>
            {/* Turnamen boleh dijadwalkan ke depan, beda dari catat main. */}
            <DateField
              id="t-date"
              value={date}
              onChange={(v) => {
                setDate(v);
                if (endDate < v) setEndDate(v);
              }}
              allowFuture
            />
            <label className="flex cursor-pointer items-center gap-2 pt-1">
              <Switch
                checked={multiDay}
                onCheckedChange={(v: boolean) => {
                  setMultiDay(v);
                  if (v && endDate < date) setEndDate(date);
                }}
              />
              <span className="text-sm text-ink-soft">Lebih dari sehari</span>
            </label>
            {date > todayLocal() ? (
              <p className="text-[11px] font-semibold text-court">
                Dijadwalkan — muncul sebagai &quot;Akan datang&quot;.
              </p>
            ) : null}
          </div>

          {multiDay ? (
            <div className="space-y-1.5">
              <Label htmlFor="t-end-date">Tanggal selesai</Label>
              <DateField
                id="t-end-date"
                value={endDate}
                onChange={setEndDate}
                allowFuture
                min={date}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Sistem pertandingan</Label>
            <div className="flex gap-1.5">
              {TOURNAMENT_FORMATS.map((f) => (
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-size">Jumlah pasangan</Label>
            <div className="flex items-center gap-2">
              <div className="inline-flex h-11 items-center rounded-xl border border-input bg-surface">
                <button
                  type="button"
                  onClick={() => changeSize(size - 1)}
                  disabled={size <= MIN_PAIRS}
                  aria-label="Kurangi pasangan"
                  className="grid size-11 place-items-center text-ink-soft transition hover:text-ink disabled:opacity-30"
                >
                  <KIcon name="minus" className="size-4" />
                </button>
                <input
                  id="t-size"
                  inputMode="numeric"
                  value={String(size)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, "");
                    if (raw) changeSize(Number(raw));
                  }}
                  className="w-10 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                  aria-label="Jumlah pasangan"
                />
                <button
                  type="button"
                  onClick={() => changeSize(size + 1)}
                  disabled={size >= MAX_PAIRS}
                  aria-label="Tambah pasangan"
                  className="grid size-11 place-items-center text-ink-soft transition hover:text-ink disabled:opacity-30"
                >
                  <KIcon name="plus" className="size-4" />
                </button>
              </div>
              <div className="flex flex-1 gap-1.5">
                {SIZE_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => changeSize(n)}
                    aria-pressed={size === n}
                    className={cn(
                      "h-11 flex-1 rounded-xl text-sm font-bold transition",
                      size === n
                        ? "bg-court text-white shadow-court"
                        : "bg-surface-2 text-ink-soft hover:bg-court/10 hover:text-court",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-ink-faint">
              {format === "knockout"
                ? byeSlots > 0
                  ? `Bagan ${slots} slot — ${byeSlots} slot jadi BYE otomatis.`
                  : `Bagan ${slots} slot, pas tanpa BYE.`
                : `${rrMatches} partai — setiap pasangan ketemu semua pasangan lain sekali.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Format skor</Label>
            <div className="flex gap-1.5">
              {SCORE_FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setScoreFormat(f.value)}
                  aria-pressed={scoreFormat === f.value}
                  className={cn(
                    "flex-1 rounded-xl px-2 py-2 text-center transition",
                    scoreFormat === f.value
                      ? "bg-court text-white shadow-court"
                      : "bg-surface-2 text-ink-soft hover:bg-court/10 hover:text-court",
                  )}
                >
                  <span className="block text-sm font-bold">{f.label}</span>
                  <span className="block text-[10px] opacity-80">{f.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint">
              Bawaan buat semua partai — tetap bisa diganti per partai waktu isi skor.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Pasangan</Label>
              <span className="text-[11px] text-ink-faint">
                {filledPairs}/{size} pasangan · {participants} peserta
              </span>
            </div>
            {pairs.map((p, i) => {
              const empty = !p.a.trim() && !p.b.trim();
              return (
                <div key={i} className="rounded-2xl border border-line bg-surface-2/60 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                    <span className="grid size-5 place-items-center rounded-md bg-court/10 text-[10px] text-court">
                      {i + 1}
                    </span>
                    Slot {i + 1}
                    {empty ? (
                      <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint">
                        {format === "knockout" ? "BYE" : "Kosong"}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <PlayerNameInput
                      value={p.a}
                      onChange={(v) => setPair(i, { a: v })}
                      names={playerNames}
                      photoMap={photoMap}
                      placeholder="Pemain 1"
                      ariaLabel={`Slot ${i + 1} pemain 1`}
                    />
                    <PlayerNameInput
                      value={p.b}
                      onChange={(v) => setPair(i, { b: v })}
                      names={playerNames}
                      photoMap={photoMap}
                      placeholder="Pemain 2"
                      ariaLabel={`Slot ${i + 1} pemain 2`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-fee">Patungan per orang</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-faint">
                Rp
              </span>
              <Input
                id="t-fee"
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <p className="text-[11px] text-ink-faint">
              Bisa diatur ulang nanti — saran nominal muncul setelah kok tercatat. Isi 0 kalau
              gratis.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-notes">Catatan (opsional)</Label>
            <Input
              id="t-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Lapangan 3, mulai 19.00"
              maxLength={200}
              className="h-11 rounded-xl"
            />
          </div>
        </div>

        <SheetFooter className="shrink-0 px-4">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
          >
            <KIcon name="trophy" className="size-4" />
            {pending ? "Menyimpan…" : "Bikin turnamen"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
