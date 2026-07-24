"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { KokType } from "@/lib/domain/types";
import { expenseFromInitialStock, slopsFromStock } from "@/lib/domain/stock";
import { formatRupiah } from "@/lib/format";
import {
  adjustStockAction,
  buyStockAction,
  createKokTypeAction,
  deleteKokTypeAction,
  patchKokTypeAction,
} from "@/server/actions/kokTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KIcon } from "@/components/kok/icons";

function BuyDialog({ type }: { type: KokType }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slops, setSlops] = useState("1");
  const [price, setPrice] = useState(String(type.pricePerSlop || ""));
  const [pending, startTransition] = useTransition();

  const slopN = Number(slops) || 0;
  const priceN = Number(price) || 0;
  const total = slopN * priceN;

  const buy = () =>
    startTransition(async () => {
      if (!(slopN > 0)) {
        toast.error("Jumlah slop harus > 0");
        return;
      }
      const res = await buyStockAction(type.id, slopN, price ? priceN : undefined);
      if (res.ok) {
        const effPrice = price ? priceN : Number(type.pricePerSlop) || 0;
        toast.success(
          `+${slopN * 12} kok (${type.name}) · kas −${formatRupiah(slopN * effPrice)}`,
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" />}>
        <ShoppingCart className="size-4" /> Beli slop
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Beli slop — {type.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Stok sekarang {type.stock} · 1 slop = 12 kok · kas berkurang total di bawah.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="slops">Slop (×12)</Label>
            <Input
              id="slops"
              inputMode="numeric"
              value={slops}
              onChange={(e) => setSlops(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pps">Harga/slop</Label>
            <Input
              id="pps"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
        </div>
        <p className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground">
          +{slopN * 12} kok · kas −{formatRupiah(total)}
        </p>
        <DialogFooter>
          <Button onClick={buy} disabled={pending || !(slopN > 0)} className="w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Catat pembelian"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ type }: { type: KokType }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(type.name);
  const [price, setPrice] = useState(String(type.pricePerPerson));
  const [slop, setSlop] = useState(String(type.pricePerSlop));
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const res = await patchKokTypeAction(type.id, {
        name,
        pricePerPerson: Number(price),
        pricePerSlop: Number(slop),
      });
      if (res.ok) {
        toast.success("Jenis kok diperbarui");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon" variant="outline" className="size-8" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Edit jenis kok</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`n-${type.id}`}>Nama</Label>
            <Input id={`n-${type.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`p-${type.id}`}>Harga/org</Label>
              <Input
                id={`p-${type.id}`}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`s-${type.id}`}>Harga/slop</Label>
              <Input
                id={`s-${type.id}`}
                inputMode="numeric"
                value={slop}
                onChange={(e) => setSlop(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending} className="w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeRow({ type }: { type: KokType }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const del = () =>
    startTransition(async () => {
      if (!confirm(`Hapus jenis kok ${type.name}?`)) return;
      const res = await deleteKokTypeAction(type.id);
      if (res.ok) {
        toast.success("Jenis kok dihapus");
        router.refresh();
      } else toast.error(res.error);
    });

  const tweak = (delta: number) =>
    startTransition(async () => {
      const res = await adjustStockAction(type.id, delta);
      if (res.ok) {
        toast.success(delta > 0 ? `Stok +${delta}` : `Stok ${delta}`);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card className="gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{type.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatRupiah(type.pricePerPerson)}/org
            {type.pricePerSlop > 0 ? ` · ${formatRupiah(type.pricePerSlop)}/slop` : ""}
          </p>
        </div>
        <Badge variant={type.stock > 0 ? "secondary" : "outline"} className="gap-1 shrink-0">
          <Package className="size-3" /> stok {type.stock}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5 shadow-card">
          <button
            type="button"
            aria-label="Kurangi 1 kok"
            disabled={pending || type.stock <= 0}
            onClick={() => tweak(-1)}
            className="grid size-8 place-items-center rounded-lg text-ink-soft transition hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40"
          >
            <KIcon name="minus" className="size-4" />
          </button>
          <span className="tabular min-w-8 text-center font-mono text-sm font-bold text-ink">
            {type.stock}
          </span>
          <button
            type="button"
            aria-label="Tambah 1 kok"
            disabled={pending}
            onClick={() => tweak(1)}
            className="grid size-8 place-items-center rounded-lg text-ink-soft transition hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40"
          >
            <KIcon name="plus" className="size-4" />
          </button>
        </div>
        <BuyDialog type={type} />
        <div className="ml-auto flex items-center gap-1">
          <EditDialog type={type} />
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={del}
            disabled={pending}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function KokTypesPanel({ kokTypes }: { kokTypes: KokType[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [slop, setSlop] = useState("");
  const [stock, setStock] = useState("");
  const [pending, startTransition] = useTransition();

  const stockN = stock ? Number(stock) : 0;
  const slopN = slop ? Number(slop) : 0;
  const expense = expenseFromInitialStock(stockN, slopN);

  const add = () =>
    startTransition(async () => {
      const res = await createKokTypeAction({
        name,
        pricePerPerson: Number(price),
        pricePerSlop: slopN,
        stock: stockN,
      });
      if (res.ok) {
        toast.success(
          expense > 0
            ? `Jenis kok ditambah · kas −${formatRupiah(expense)}`
            : "Jenis kok ditambah (isi stok + harga/slop biar kas berkurang)",
        );
        setName("");
        setPrice("");
        setSlop("");
        setStock("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <div className="space-y-3">
      <Card className="gap-3 rounded-xl2 p-4">
        <p className="text-sm font-semibold">Tambah jenis kok</p>
        <p className="text-xs text-muted-foreground">
          Isi <strong>harga/slop</strong> + <strong>stok awal</strong> supaya kas langsung berkurang
          (1 slop = 12 kok). Contoh: stok 12 + harga/slop 130.000 → kas −Rp130.000.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="kt-name">Nama</Label>
          <Input
            id="kt-name"
            placeholder="cth. Indra Silver"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="kt-price">Harga / orang</Label>
            <Input
              id="kt-price"
              placeholder="3000"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kt-slop">Harga / slop (beli)</Label>
            <Input
              id="kt-slop"
              placeholder="130000"
              inputMode="numeric"
              value={slop}
              onChange={(e) => setSlop(e.target.value.replace(/[^\d]/g, ""))}
              className="rounded-xl"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kt-stock">Stok awal (pcs)</Label>
          <Input
            id="kt-stock"
            placeholder="12 (= 1 slop)"
            inputMode="numeric"
            value={stock}
            onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ""))}
            className="rounded-xl"
          />
        </div>
        {expense > 0 ? (
          <p className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground">
            Kas akan −{formatRupiah(expense)} (
            {slopsFromStock(stockN)} slop × {formatRupiah(slopN)})
          </p>
        ) : null}
        <Button onClick={add} disabled={pending || !name || !price} className="w-full rounded-xl">
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Tambah"}
        </Button>
      </Card>

      {kokTypes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Belum ada jenis kok.</p>
      ) : (
        kokTypes.map((t) => <TypeRow key={t.id} type={t} />)
      )}
    </div>
  );
}
