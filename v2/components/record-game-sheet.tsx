"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { KokType, PlayerRow } from "@/lib/domain/types";
import { formatRupiah } from "@/lib/format";
import { createGameAction } from "@/server/actions/games";
import { PlayerNameInput } from "@/components/kok/player-name-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function RecordGameSheet({
  kokTypes,
  players,
  defaultPrice,
}: {
  kokTypes: KokType[];
  players: PlayerRow[];
  defaultPrice: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [names, setNames] = useState(["", "", "", ""]);
  const [typeId, setTypeId] = useState("");
  const [count, setCount] = useState("1");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");

  const active = kokTypes.filter((t) => t.active);
  const playerNames = players.map((p) => p.name);
  const selected = active.find((t) => t.id === typeId);
  const effPrice = price ? Number(price) : (selected?.pricePerPerson ?? defaultPrice);
  const perPerson = effPrice * Math.max(1, Number(count) || 1);

  const reset = () => {
    setNames(["", "", "", ""]);
    setTypeId("");
    setCount("1");
    setPrice("");
    setDate(todayLocal());
    setNotes("");
  };

  const submit = () => {
    if (names.some((n) => !n.trim())) {
      toast.error("Isi 4 nama pemain");
      return;
    }
    startTransition(async () => {
      const res = await createGameAction({
        pairs: { a: [names[0], names[1]], b: [names[2], names[3]] },
        typeId: typeId || undefined,
        kokCount: Math.max(1, Number(count) || 1),
        pricePerPerson: price ? Number(price) : undefined,
        date,
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        toast.success("Game dicatat");
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button className="w-full gap-1.5" />}>
        <Plus className="size-4" /> Catat main
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Catat main</SheetTitle>
          <SheetDescription>2 pasangan (4 pemain) + kok yang dipakai.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          {([0, 1] as const).map((pair) => (
            <div key={pair} className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Pair {pair === 0 ? "A" : "B"}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((j) => {
                  const idx = pair * 2 + j;
                  return (
                    <PlayerNameInput
                      key={idx}
                      names={playerNames}
                      placeholder={`Pemain ${idx + 1}`}
                      value={names[idx]}
                      onChange={(v) => {
                        const next = [...names];
                        next[idx] = v;
                        setNames(next);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Jenis kok</Label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">Default / custom</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {formatRupiah(t.pricePerPerson)} (stok {t.stock})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Jumlah kok</Label>
              <Input
                id="count"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="price">Harga/org per kok</Label>
              <Input
                id="price"
                inputMode="numeric"
                placeholder={String(selected?.pricePerPerson ?? defaultPrice)}
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Tanggal</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Catatan (opsional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-accent px-3 py-2 text-sm">
            <span className="text-accent-foreground">Per orang</span>
            <span className="tabular font-semibold text-accent-foreground">
              {formatRupiah(perPerson)}
            </span>
          </div>
        </div>

        <SheetFooter>
          <Button onClick={submit} disabled={pending} className="w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Simpan game"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
