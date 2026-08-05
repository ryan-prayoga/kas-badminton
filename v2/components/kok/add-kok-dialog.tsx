"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { EnrichedGame, KokType } from "@/lib/domain/types";
import { formatRupiah, formatThousands } from "@/lib/format";
import { updateGameAction } from "@/server/actions/games";
import { KIcon } from "@/components/kok/icons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { safeAction } from "@/lib/action-result";

const CUSTOM = "__custom__";

interface KokLine {
  key: string;
  typeId: string;
  count: string;
  price: string;
}

function defaultTypeId(active: KokType[]): string {
  const withStock = active.filter((t) => (Number(t.stock) || 0) > 0);
  return (withStock[0] ?? active[0])?.id ?? CUSTOM;
}

function firstLine(game: EnrichedGame, active: KokType[], defaultPrice: number): KokLine {
  const last = game.koks[game.koks.length - 1];
  const t = last?.typeId ? active.find((x) => x.id === last.typeId) : undefined;
  return {
    key: `${game.koks.length}-0`,
    typeId: t ? t.id : last?.typeId ? last.typeId : defaultTypeId(active),
    count: "1",
    price: String(last?.pricePerPerson ?? t?.pricePerPerson ?? defaultPrice),
  };
}

export function AddKokDialog({
  game,
  kokTypes,
  defaultPrice,
  disabled = false,
}: {
  game: EnrichedGame;
  kokTypes: KokType[];
  defaultPrice: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Tipe nonaktif tapi masih dipakai di game ini tetap ditampilkan biar bisa dipilih lagi.
  const active = kokTypes.filter((t) => t.active || game.koks.some((k) => k.typeId === t.id));
  const selectable = active.filter((t) => (Number(t.stock) || 0) > 0);

  const [lines, setLines] = useState<KokLine[]>(() => [firstLine(game, active, defaultPrice)]);

  const typeOptionsFor = (typeId: string) => {
    const selected = active.find((t) => t.id === typeId);
    if (selected && !selectable.some((t) => t.id === selected.id)) {
      return [selected, ...selectable];
    }
    return selectable;
  };

  const setLine = (key: string, patch: Partial<KokLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onTypeChange = (key: string, v: string | null) => {
    const next = v ?? CUSTOM;
    const t = active.find((x) => x.id === next);
    setLine(key, { typeId: next, price: t ? String(t.pricePerPerson) : "" });
  };

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, typeId: defaultTypeId(active), count: "1", price: String(defaultPrice) },
    ]);

  const removeLine = (key: string) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const bumpCount = (key: string, delta: number) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = Math.max(1, Math.min(50, (Number(l.count) || 1) + delta));
        return { ...l, count: String(n) };
      }),
    );

  const totalNew = lines.reduce((s, l) => s + Math.max(1, Number(l.count) || 1), 0);

  const submit = () => {
    const existing = game.koks.map((k) => ({
      id: k.id,
      typeId: k.typeId,
      typeName: k.typeName,
      pricePerPerson: k.pricePerPerson,
    }));
    const added = lines.flatMap((line) => {
      const n = Math.max(1, Math.min(50, Number(line.count) || 1));
      const t = active.find((x) => x.id === line.typeId);
      const typeId = line.typeId === CUSTOM ? null : line.typeId;
      const price = line.price ? Number(line.price) || 0 : (t?.pricePerPerson ?? defaultPrice);
      return Array.from({ length: n }, () => ({
        typeId,
        typeName: t ? t.name : null,
        pricePerPerson: price,
      }));
    });

    start(async () => {
      const res = await safeAction(() =>
        updateGameAction(game.id, { koks: [...existing, ...added] }),
      );
      if (res.ok) {
        toast.success(totalNew > 1 ? `${totalNew} kok ditambah` : "Kok ditambah");
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
        if (v) setLines([firstLine(game, active, defaultPrice)]);
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Tambah kok"
            disabled={disabled}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-court/10 hover:text-court disabled:pointer-events-none disabled:opacity-40"
          />
        }
      >
        <KIcon name="plus" className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Tambah kok</DialogTitle>
          <DialogDescription>Nambah kok ke game ini. Stok kepotong otomatis.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">
              Kok dipakai
            </span>
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
                    <Select value={line.typeId} onValueChange={(v) => onTypeChange(line.key, v)}>
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
                      <SelectContent className="rounded-xl p-1.5" alignItemWithTrigger={false}>
                        <SelectItem value={CUSTOM} className="rounded-lg px-3 py-2.5">
                          Custom / tanpa stok
                        </SelectItem>
                        {options.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="rounded-lg px-3 py-2.5">
                            <span className="flex w-full min-w-0 items-center justify-between gap-3">
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
                        disabled={(Number(line.count) || 0) <= 1}
                        className="grid size-10 place-items-center text-ink-soft transition hover:text-ink disabled:opacity-30"
                        aria-label="Kurangi jumlah"
                      >
                        <KIcon name="minus" className="size-4" />
                      </button>
                      <input
                        inputMode="numeric"
                        value={line.count}
                        onChange={(e) =>
                          setLine(line.key, { count: e.target.value.replace(/[^\d]/g, "") })
                        }
                        onBlur={(e) => {
                          if (!e.target.value) setLine(line.key, { count: "1" });
                        }}
                        className="w-8 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                        aria-label="Jumlah kok"
                      />
                      <button
                        type="button"
                        onClick={() => bumpCount(line.key, 1)}
                        disabled={(Number(line.count) || 0) >= 50}
                        className="grid size-10 place-items-center text-ink-soft transition hover:text-ink disabled:opacity-30"
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
                        placeholder={formatThousands(String(selected?.pricePerPerson ?? defaultPrice))}
                        value={formatThousands(line.price)}
                        onChange={(e) =>
                          setLine(line.key, { price: e.target.value.replace(/[^\d]/g, "") })
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
            Bisa campur jenis kok berbeda. Nambah total {totalNew} kok.
          </p>
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
