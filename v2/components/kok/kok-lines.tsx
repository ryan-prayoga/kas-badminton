"use client";

// Editor "kok dipakai" — dipakai bareng sheet bikin turnamen dan dialog tambah
// kok turnamen. Bentuknya sengaja sama dengan baris kok di catat-main.

import { clampToTournament } from "@/lib/domain/tournament";
import type { Kok, KokType } from "@/lib/domain/types";
import { formatRupiah, formatThousands, toLocalIso } from "@/lib/format";
import { DateField } from "@/components/kok/date-field";
import { KIcon } from "@/components/kok/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const CUSTOM_KOK = "__custom__";

export interface KokLine {
  key: string;
  typeId: string;
  count: string;
  price: string;
}

function lineKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultKokTypeId(active: KokType[]): string {
  const withStock = active.filter((t) => (Number(t.stock) || 0) > 0);
  return (withStock[0] ?? active[0])?.id ?? CUSTOM_KOK;
}

export function newKokLine(active: KokType[], defaultPrice: number, count = "1"): KokLine {
  const typeId = defaultKokTypeId(active);
  const t = active.find((x) => x.id === typeId);
  return {
    key: lineKey(),
    typeId,
    count,
    price: t ? String(t.pricePerPerson) : String(defaultPrice),
  };
}

/** Baris UI → daftar kok datar siap dikirim ke server. */
export function kokLinesToKoks(
  lines: KokLine[],
  active: KokType[],
  defaultPrice: number,
): Array<Partial<Kok>> {
  return lines.flatMap((line) => {
    const n = Math.max(0, Math.min(200, Number(line.count) || 0));
    if (n === 0) return [];
    const t = active.find((x) => x.id === line.typeId);
    const typeId = line.typeId === CUSTOM_KOK ? null : line.typeId;
    const price = line.price ? Number(line.price) || 0 : (t?.pricePerPerson ?? defaultPrice);
    return Array.from({ length: n }, () => ({
      typeId,
      typeName: t ? t.name : null,
      pricePerPerson: price,
    }));
  });
}

export function totalKokFromLines(lines: KokLine[]): number {
  return lines.reduce((s, l) => s + Math.max(0, Number(l.count) || 0), 0);
}

/** Total rupiah kok (harga per kok = pricePerPerson × 4, sama seperti game). */
export function totalRupiahFromLines(
  lines: KokLine[],
  active: KokType[],
  defaultPrice: number,
): number {
  return lines.reduce((s, l) => {
    const n = Math.max(0, Number(l.count) || 0);
    const t = active.find((x) => x.id === l.typeId);
    const unit = l.price ? Number(l.price) || 0 : (t?.pricePerPerson ?? defaultPrice);
    return s + unit * 4 * n;
  }, 0);
}

/** Hari ini kalau masih dalam rentang turnamen; kalau tidak, hari pertama turnamen. */
export function defaultKokDate(startDate: string, endDate: string | null): string {
  return clampToTournament(toLocalIso(new Date()), startDate, endDate);
}

/**
 * Tanggal kok dipakai. Turnamen sehari tidak perlu pilihan — tampilkan info saja,
 * biar formnya tidak nambah langkah yang tak berguna.
 */
export function KokDateField({
  value,
  onChange,
  startDate,
  endDate,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  startDate: string;
  endDate: string | null;
  id?: string;
}) {
  if (!endDate || endDate <= startDate) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Dipakai tanggal</Label>
      <DateField
        id={id}
        value={value}
        onChange={onChange}
        min={startDate}
        max={endDate}
        allowFuture
      />
    </div>
  );
}

export function KokLinesEditor({
  lines,
  setLines,
  kokTypes,
  defaultPrice,
  maxCount = 200,
}: {
  lines: KokLine[];
  setLines: React.Dispatch<React.SetStateAction<KokLine[]>>;
  kokTypes: KokType[];
  defaultPrice: number;
  maxCount?: number;
}) {
  const active = kokTypes.filter((t) => t.active);
  const selectable = active.filter((t) => (Number(t.stock) || 0) > 0);

  const optionsFor = (typeId: string) => {
    const selected = active.find((t) => t.id === typeId);
    if (selected && !selectable.some((t) => t.id === selected.id)) return [selected, ...selectable];
    return selectable;
  };

  const setLine = (key: string, patch: Partial<KokLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onTypeChange = (key: string, v: string | null) => {
    const next = v ?? CUSTOM_KOK;
    const t = active.find((x) => x.id === next);
    setLine(key, { typeId: next, price: t ? String(t.pricePerPerson) : "" });
  };

  const bump = (key: string, delta: number) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = Math.max(0, Math.min(maxCount, (Number(l.count) || 0) + delta));
        return { ...l, count: String(n) };
      }),
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">
          Kok dipakai
        </span>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, newKokLine(active, defaultPrice)])}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
        >
          <KIcon name="plus" className="size-3.5" />
          Tambah jenis
        </button>
      </div>

      {lines.map((line) => {
        const selected = active.find((t) => t.id === line.typeId);
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
                      if (!value || value === CUSTOM_KOK) return "Custom / tanpa stok";
                      const t = active.find((x) => x.id === value);
                      return t ? `${t.name} · stok ${t.stock}` : "Custom / tanpa stok";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl p-1.5" alignItemWithTrigger={false}>
                  <SelectItem value={CUSTOM_KOK} className="rounded-lg px-3 py-2.5">
                    Custom / tanpa stok
                  </SelectItem>
                  {optionsFor(line.typeId).map((t) => (
                    <SelectItem key={t.id} value={t.id} className="rounded-lg px-3 py-2.5">
                      <span className="flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden">
                        <span className="min-w-0 truncate">{t.name}</span>
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
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls))}
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
                  onClick={() => bump(line.key, -1)}
                  disabled={(Number(line.count) || 0) <= 0}
                  className="grid size-10 place-items-center text-ink-soft transition hover:text-ink disabled:opacity-30"
                  aria-label="Kurangi jumlah"
                >
                  <KIcon name="minus" className="size-4" />
                </button>
                <input
                  inputMode="numeric"
                  value={line.count}
                  onChange={(e) => setLine(line.key, { count: e.target.value.replace(/[^\d]/g, "") })}
                  onBlur={(e) => {
                    if (!e.target.value) setLine(line.key, { count: "0" });
                  }}
                  className="w-10 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
                  aria-label="Jumlah kok"
                />
                <button
                  type="button"
                  onClick={() => bump(line.key, 1)}
                  disabled={(Number(line.count) || 0) >= maxCount}
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
                  onChange={(e) => setLine(line.key, { price: e.target.value.replace(/[^\d]/g, "") })}
                  className="h-10 rounded-xl pl-9"
                  aria-label="Harga per orang"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
