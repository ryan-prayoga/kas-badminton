"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { EnrichedGame, KokType } from "@/lib/domain/types";
import { addKokAction } from "@/server/actions/games";
import { KIcon } from "@/components/kok/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function lastKokOf(game: EnrichedGame) {
  return game.koks[game.koks.length - 1];
}

export function AddKokDialog({
  game,
  kokTypes,
  defaultPrice,
}: {
  game: EnrichedGame;
  kokTypes: KokType[];
  defaultPrice: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const last = lastKokOf(game);
  const [typeId, setTypeId] = useState(last?.typeId ?? "");
  const [price, setPrice] = useState(String(last?.pricePerPerson ?? defaultPrice));

  // Tipe nonaktif tapi masih dipakai di game ini tetap ditampilkan biar bisa dipilih lagi.
  const active = kokTypes.filter((t) => t.active || game.koks.some((k) => k.typeId === t.id));

  const submit = () => {
    start(async () => {
      const res = await addKokAction(game.id, {
        typeId: typeId || null,
        typeName: active.find((t) => t.id === typeId)?.name ?? null,
        pricePerPerson: Number(price) || 0,
      });
      if (res.ok) {
        toast.success("Kok ditambah");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          // Isi ulang dari kok terakhir tiap dialog dibuka — game.koks bisa udah
          // berubah sejak render sebelumnya.
          const l = lastKokOf(game);
          setTypeId(l?.typeId ?? "");
          setPrice(String(l?.pricePerPerson ?? defaultPrice));
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Tambah kok"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-court/10 hover:text-court"
          />
        }
      >
        <KIcon name="plus" className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Tambah kok</DialogTitle>
          <DialogDescription>Nambah 1 kok ke game ini. Stok kepotong otomatis.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <select
            value={typeId}
            onChange={(e) => {
              const t = active.find((x) => x.id === e.target.value);
              setTypeId(e.target.value);
              if (t) setPrice(String(t.pricePerPerson));
            }}
            className="h-10 flex-1 rounded-xl border border-input bg-surface px-3 text-sm text-ink outline-none focus:border-court/50"
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
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            className="h-10 w-24 shrink-0 rounded-xl border border-input bg-surface px-3 text-sm text-ink outline-none focus:border-court/50"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
        >
          <KIcon name="plus" className="size-4" /> Tambah kok
        </button>
      </DialogContent>
    </Dialog>
  );
}
