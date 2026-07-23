"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { EnrichedGame, KokType, PlayerRow } from "@/lib/domain/types";
import { fmt } from "@/lib/format";
import { updateGameAction } from "@/server/actions/games";
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

interface KokRow {
  id?: string;
  typeId: string;
  price: string;
}

export function EditGameSheet({
  game,
  kokTypes,
  players,
  defaultPrice,
}: {
  game: EnrichedGame;
  kokTypes: KokType[];
  players: PlayerRow[];
  defaultPrice: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [names, setNames] = useState(game.players.map((p) => p.name));
  const [date, setDate] = useState(game.date);
  const [notes, setNotes] = useState(game.notes ?? "");
  const [koks, setKoks] = useState<KokRow[]>(
    game.koks.map((k) => ({ id: k.id, typeId: k.typeId ?? "", price: String(k.pricePerPerson) })),
  );

  const active = kokTypes.filter((t) => t.active || game.koks.some((k) => k.typeId === t.id));
  const perPerson = koks.reduce((s, k) => s + (Number(k.price) || 0), 0);

  const setKok = (i: number, patch: Partial<KokRow>) =>
    setKoks((ks) => ks.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));

  const addKok = () => setKoks((ks) => [...ks, { typeId: "", price: String(defaultPrice) }]);
  const removeKok = (i: number) => setKoks((ks) => (ks.length > 1 ? ks.filter((_, idx) => idx !== i) : ks));

  const submit = () => {
    if (names.some((n) => !n.trim())) return toast.error("Isi 4 nama pemain");
    if (koks.length === 0) return toast.error("Minimal 1 kok");
    start(async () => {
      const res = await updateGameAction(game.id, {
        pairs: { a: [names[0], names[1]], b: [names[2], names[3]] },
        date,
        notes: notes.trim(),
        koks: koks.map((k) => ({
          id: k.id,
          typeId: k.typeId || null,
          pricePerPerson: Number(k.price) || 0,
        })),
      });
      if (res.ok) {
        toast.success("Game diperbarui");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg text-ink-faint transition hover:bg-court/10 hover:text-court"
          />
        }
      >
        <KIcon name="pencil" className="size-4" />
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">Edit game</SheetTitle>
          <SheetDescription>Ubah pemain, kok, tanggal, atau catatan.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          {([0, 1] as const).map((pair) => (
            <div key={pair} className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                Pair {pair === 0 ? "A" : "B"}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((j) => {
                  const idx = pair * 2 + j;
                  return (
                    <PlayerNameInput
                      key={idx}
                      names={players.map((p) => p.name)}
                      value={names[idx]}
                      onChange={(v) => setNames((n) => n.map((x, k) => (k === idx ? v : x)))}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wide text-ink-faint">Kok</label>
              <button type="button" onClick={addKok} className="inline-flex items-center gap-1 text-xs font-semibold text-court">
                <KIcon name="plus" className="size-3.5" /> Tambah kok
              </button>
            </div>
            <div className="space-y-2">
              {koks.map((k, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={k.typeId}
                    onChange={(e) => {
                      const t = kokTypes.find((x) => x.id === e.target.value);
                      setKok(i, { typeId: e.target.value, price: t ? String(t.pricePerPerson) : k.price });
                    }}
                    className="h-9 flex-1 rounded-xl border border-input bg-surface px-3 text-sm outline-none focus:border-court/50"
                  >
                    <option value="">Custom</option>
                    {active.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    value={k.price}
                    onChange={(e) => setKok(i, { price: e.target.value.replace(/[^\d]/g, "") })}
                    className="w-24 rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50"
                  />
                  <button
                    type="button"
                    onClick={() => removeKok(i)}
                    className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-faint hover:text-danger"
                  >
                    <KIcon name="trash" className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-ink-faint">Tanggal</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-ink-faint">Per orang</label>
              <div className="tabular flex h-[38px] items-center rounded-xl bg-court/8 px-3 font-mono text-sm font-bold text-court">
                {fmt(perPerson)}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-ink-faint">Catatan</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50"
            />
          </div>
        </div>

        <SheetFooter>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-court py-2.5 font-semibold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <KIcon name="save" className="size-4" />}
            Simpan perubahan
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
