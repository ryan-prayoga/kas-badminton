"use client";

// Sheet buat ganti nama pemain per slot pasangan turnamen yang sudah dibuat —
// jumlah pasangan (size) tidak bisa diubah di sini, cuma isi slotnya. Pola UI
// niru bagian "Pasangan" di CreateTournamentSheet biar konsisten.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { EnrichedTournament, PlayerRow } from "@/lib/domain/types";
import { safeAction } from "@/lib/action-result";
import { updateTournamentAction } from "@/server/actions/tournaments";
import { buildPhotoMap } from "@/components/kok/avatar";
import { KIcon } from "@/components/kok/icons";
import { PlayerNameInput } from "@/components/kok/player-name-input";
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

function pairsFromTournament(t: Pick<EnrichedTournament, "pairs" | "size">): PairDraft[] {
  return Array.from({ length: t.size }, (_, i) => ({
    a: t.pairs[i]?.a ?? "",
    b: t.pairs[i]?.b ?? "",
  }));
}

export function EditPairsSheet({
  tournament,
  players,
}: {
  tournament: EnrichedTournament;
  players: PlayerRow[];
}) {
  const t = tournament;
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<PairDraft[]>(() => pairsFromTournament(t));
  const [pending, start] = useTransition();

  const photoMap = useMemo(() => buildPhotoMap(players), [players]);
  const playerNames = useMemo(() => players.map((p) => p.name), [players]);

  const setPair = (i: number, patch: Partial<PairDraft>) =>
    setPairs((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const submit = () => {
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
        updateTournamentAction(t.id, {
          pairs: pairs.map((p) => ({ a: p.a.trim(), b: p.b.trim() })),
        }),
      );
      if (res.ok) {
        toast.success("Pasangan diperbarui");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Reset ke data terbaru tiap dibuka, biar gak ketimpa draft basi kalau
        // dibuka-tutup tanpa disimpan.
        if (v) setPairs(pairsFromTournament(t));
      }}
    >
      <SheetTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
          >
            <KIcon name="pencil" className="size-3.5" /> Ubah pasangan
          </button>
        }
      />

      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden rounded-t-[1.75rem] border-line pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="shrink-0 pr-12">
          <SheetTitle className="font-display">Ubah pasangan</SheetTitle>
          <SheetDescription>
            Ganti nama pemain di tiap slot. Jumlah pasangan ({t.size}) tidak bisa diubah di sini.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
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
                      {t.format === "knockout" ? "BYE" : "Kosong"}
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

        <SheetFooter className="shrink-0 px-4">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
          >
            <KIcon name="save" className="size-4" />
            {pending ? "Menyimpan…" : "Simpan pasangan"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
