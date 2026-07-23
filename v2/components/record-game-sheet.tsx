"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { KokType, PlayerRow } from "@/lib/domain/types";
import { formatRupiah } from "@/lib/format";
import { createGameAction } from "@/server/actions/games";
import { buildPhotoMap } from "@/components/kok/avatar";
import { PlayerNameInput } from "@/components/kok/player-name-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const CUSTOM = "__custom__";

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function defaultTypeId(active: KokType[]): string {
  const withStock = active.filter((t) => (Number(t.stock) || 0) > 0);
  return (withStock[0] ?? active[0])?.id ?? CUSTOM;
}

export function RecordGameSheet({
  kokTypes,
  players,
  defaultPrice,
  trigger,
}: {
  kokTypes: KokType[];
  players: PlayerRow[];
  defaultPrice: number;
  /** Custom trigger (mis. FAB bulat di nav). Default: tombol full-width. */
  trigger?: ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = useMemo(() => kokTypes.filter((t) => t.active), [kokTypes]);
  // opsi select: yang stok > 0; type terpilih yang stok 0 tetap boleh ditampilkan jika sudah terpilih
  const selectable = useMemo(
    () => active.filter((t) => (Number(t.stock) || 0) > 0),
    [active],
  );

  const [names, setNames] = useState(["", "", "", ""]);
  const [typeId, setTypeId] = useState(() => defaultTypeId(active));
  const [count, setCount] = useState("1");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");

  const photoMap = useMemo(() => buildPhotoMap(players), [players]);
  const playerNames = players.map((p) => p.name);
  const selected = active.find((t) => t.id === typeId);
  const effPrice = price ? Number(price) : (selected?.pricePerPerson ?? defaultPrice);
  const perPerson = effPrice * Math.max(1, Number(count) || 1);

  // pastikan type terpilih tetap di list meski stok 0 (mis. stok habis di sesi)
  const typeOptions = useMemo(() => {
    if (selected && !selectable.some((t) => t.id === selected.id)) {
      return [selected, ...selectable];
    }
    return selectable;
  }, [selectable, selected]);

  const reset = () => {
    setNames(["", "", "", ""]);
    setTypeId(defaultTypeId(active));
    setCount("1");
    setPrice("");
    setDate(todayLocal());
    setNotes("");
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // refresh default type tiap buka (stok mungkin berubah)
      setTypeId(defaultTypeId(active));
    }
  };

  const onTypeChange = (v: string | null) => {
    const next = v ?? CUSTOM;
    setTypeId(next);
    if (next !== CUSTOM) {
      const t = active.find((x) => x.id === next);
      if (t) setPrice("");
    }
  };

  const submit = () => {
    if (names.some((n) => !n.trim())) {
      toast.error("Isi 4 nama pemain");
      return;
    }
    startTransition(async () => {
      const res = await createGameAction({
        pairs: { a: [names[0], names[1]], b: [names[2], names[3]] },
        typeId: typeId === CUSTOM ? undefined : typeId,
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

  const defaultTrigger = (
    <Button className="w-full gap-1.5 rounded-xl">
      <Plus className="size-4" /> Catat main
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={trigger ?? defaultTrigger} />
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-[1.75rem] border-line pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle className="font-display">Catat main</SheetTitle>
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
                      photoMap={photoMap}
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
              <Select value={typeId} onValueChange={onTypeChange}>
                <SelectTrigger className="h-10 w-full rounded-xl border-input bg-surface px-3">
                  <SelectValue>
                    {(value: string | null) => {
                      if (!value || value === CUSTOM) return "Default / custom";
                      const t = active.find((x) => x.id === value);
                      if (!t) return "Default / custom";
                      return `${t.name} · stok ${t.stock}`;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl" alignItemWithTrigger={false}>
                  <SelectItem value={CUSTOM} className="rounded-lg">
                    Default / custom
                  </SelectItem>
                  {typeOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="rounded-lg">
                      <span className="flex w-full min-w-0 items-center justify-between gap-2">
                        <span className="truncate">{t.name}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {formatRupiah(t.pricePerPerson)} · stok {t.stock}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Jumlah kok</Label>
              <Input
                id="count"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="price">Harga kok per orang</Label>
              <Input
                id="price"
                inputMode="numeric"
                placeholder={String(selected?.pricePerPerson ?? defaultPrice)}
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Tanggal</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Catatan (opsional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-accent px-3 py-2.5 text-sm">
            <span className="text-accent-foreground">Per orang</span>
            <span className="tabular font-semibold text-accent-foreground">
              {formatRupiah(perPerson)}
            </span>
          </div>
        </div>

        <SheetFooter>
          <Button onClick={submit} disabled={pending} className="w-full rounded-xl">
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Simpan game"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
