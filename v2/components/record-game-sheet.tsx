"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { KokType, PlayerRow } from "@/lib/domain/types";
import { formatRupiah } from "@/lib/format";
import { createGameAction } from "@/server/actions/games";
import { buildPhotoMap } from "@/components/kok/avatar";
import { DateField } from "@/components/kok/date-field";
import { KIcon } from "@/components/kok/icons";
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

interface KokLine {
  key: string;
  typeId: string;
  count: string;
  price: string;
}

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function defaultTypeId(active: KokType[]): string {
  const withStock = active.filter((t) => (Number(t.stock) || 0) > 0);
  return (withStock[0] ?? active[0])?.id ?? CUSTOM;
}

function newLine(active: KokType[], defaultPrice: number): KokLine {
  const typeId = defaultTypeId(active);
  const t = active.find((x) => x.id === typeId);
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    typeId,
    count: "1",
    price: t ? String(t.pricePerPerson) : String(defaultPrice),
  };
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
  const selectable = useMemo(
    () => active.filter((t) => (Number(t.stock) || 0) > 0),
    [active],
  );

  const [names, setNames] = useState(["", "", "", ""]);
  const [lines, setLines] = useState<KokLine[]>(() => [newLine(active, defaultPrice)]);
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");

  const photoMap = useMemo(() => buildPhotoMap(players), [players]);
  const playerNames = players.map((p) => p.name);

  const perPerson = lines.reduce((sum, line) => {
    const n = Math.max(1, Number(line.count) || 1);
    const t = active.find((x) => x.id === line.typeId);
    const unit = line.price
      ? Number(line.price) || 0
      : (t?.pricePerPerson ?? defaultPrice);
    return sum + unit * n;
  }, 0);

  const totalKoks = lines.reduce((s, l) => s + Math.max(1, Number(l.count) || 1), 0);

  const typeOptionsFor = (typeId: string) => {
    const selected = active.find((t) => t.id === typeId);
    if (selected && !selectable.some((t) => t.id === selected.id)) {
      return [selected, ...selectable];
    }
    return selectable;
  };

  const reset = () => {
    setNames(["", "", "", ""]);
    setLines([newLine(active, defaultPrice)]);
    setDate(todayLocal());
    setNotes("");
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLines([newLine(active, defaultPrice)]);
    }
  };

  const setLine = (key: string, patch: Partial<KokLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const onTypeChange = (key: string, v: string | null) => {
    const next = v ?? CUSTOM;
    const t = active.find((x) => x.id === next);
    setLine(key, {
      typeId: next,
      price: t ? String(t.pricePerPerson) : "",
    });
  };

  const addLine = () => setLines((ls) => [...ls, newLine(active, defaultPrice)]);

  const removeLine = (key: string) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const bumpCount = (key: string, delta: number) => {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = Math.max(1, Math.min(50, (Number(l.count) || 1) + delta));
        return { ...l, count: String(n) };
      }),
    );
  };

  const submit = () => {
    if (names.some((n) => !n.trim())) {
      toast.error("Isi 4 nama pemain");
      return;
    }
    if (lines.length === 0) {
      toast.error("Minimal 1 kok");
      return;
    }

    const koks = lines.flatMap((line) => {
      const n = Math.max(1, Math.min(50, Number(line.count) || 1));
      const typeId = line.typeId === CUSTOM ? null : line.typeId;
      const price = line.price ? Number(line.price) : undefined;
      return Array.from({ length: n }, () => ({
        typeId,
        pricePerPerson: price,
      }));
    });

    if (koks.length === 0) {
      toast.error("Minimal 1 kok");
      return;
    }

    startTransition(async () => {
      const res = await createGameAction({
        pairs: { a: [names[0], names[1]], b: [names[2], names[3]] },
        koks,
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
          <SheetDescription>
            2 pasangan (4 pemain) + satu atau lebih jenis kok.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          {([0, 1] as const).map((pair) => (
            <div key={pair} className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Pasangan {pair === 0 ? "A" : "B"}
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

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Kok dipakai
              </Label>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
              >
                <KIcon name="plus" className="size-3.5" />
                Tambah jenis
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line) => {
                const selected = active.find((t) => t.id === line.typeId);
                const options = typeOptionsFor(line.typeId);
                return (
                  <div
                    key={line.key}
                    className="space-y-2 rounded-2xl border border-line bg-surface-2/60 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={line.typeId}
                        onValueChange={(v) => onTypeChange(line.key, v)}
                      >
                        <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl border-input bg-surface px-3">
                          <SelectValue>
                            {(value: string | null) => {
                              if (!value || value === CUSTOM) return "Custom / tanpa stok";
                              const t = active.find((x) => x.id === value);
                              if (!t) return "Custom / tanpa stok";
                              return `${t.name} · stok ${t.stock}`;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-xl" alignItemWithTrigger={false}>
                          <SelectItem value={CUSTOM} className="rounded-lg">
                            Custom / tanpa stok
                          </SelectItem>
                          {options.map((t) => (
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

                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length <= 1}
                        className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                        aria-label="Hapus jenis kok"
                      >
                        <KIcon name="trash" className="size-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-[auto_1fr] gap-2">
                      <div className="inline-flex h-10 items-center rounded-xl border border-input bg-surface">
                        <button
                          type="button"
                          onClick={() => bumpCount(line.key, -1)}
                          className="grid size-10 place-items-center text-ink-soft transition hover:text-ink"
                          aria-label="Kurangi jumlah"
                        >
                          <KIcon name="minus" className="size-4" />
                        </button>
                        <input
                          inputMode="numeric"
                          value={line.count}
                          onChange={(e) =>
                            setLine(line.key, {
                              count: e.target.value.replace(/[^\d]/g, "") || "1",
                            })
                          }
                          className="w-8 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                          aria-label="Jumlah kok"
                        />
                        <button
                          type="button"
                          onClick={() => bumpCount(line.key, 1)}
                          className="grid size-10 place-items-center text-ink-soft transition hover:text-ink"
                          aria-label="Tambah jumlah"
                        >
                          <KIcon name="plus" className="size-4" />
                        </button>
                      </div>

                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-faint">
                          Rp
                        </span>
                        <Input
                          inputMode="numeric"
                          placeholder={String(selected?.pricePerPerson ?? defaultPrice)}
                          value={line.price}
                          onChange={(e) =>
                            setLine(line.key, {
                              price: e.target.value.replace(/[^\d]/g, ""),
                            })
                          }
                          className="h-10 rounded-xl pl-9"
                          aria-label="Harga per orang"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-ink-faint">
              Bisa campur jenis kok berbeda di 1 game. Total {totalKoks} kok.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="date">Tanggal</Label>
              <DateField id="date" value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Catatan (opsional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="court 3, main malam…"
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-accent px-3 py-3 text-sm">
            <span className="text-accent-foreground">Per orang</span>
            <span className="tabular text-base font-bold text-accent-foreground">
              {formatRupiah(perPerson)}
            </span>
          </div>
        </div>

        <SheetFooter className="pt-1">
          <Button
            onClick={submit}
            disabled={pending}
            className="h-12 w-full rounded-2xl text-base font-bold shadow-court"
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <KIcon name="save" className="size-5" />
                Simpan game
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
