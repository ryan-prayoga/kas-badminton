"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Package, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { KokType } from "@/lib/domain/types";
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

function BuyDialog({ type }: { type: KokType }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slops, setSlops] = useState("1");
  const [price, setPrice] = useState(String(type.pricePerSlop || ""));
  const [pending, startTransition] = useTransition();

  const buy = () =>
    startTransition(async () => {
      const res = await buyStockAction(type.id, Number(slops), price ? Number(price) : undefined);
      if (res.ok) {
        toast.success(`+${Number(slops) * 12} kok (${type.name}) · kas keluar ${formatRupiah(Number(slops) * Number(price || 0))}`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" />}>
        <ShoppingCart className="size-4" /> Beli
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Beli stok — {type.name}</DialogTitle>
        </DialogHeader>
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
        <p className="text-xs text-muted-foreground">
          Total: {formatRupiah(Number(slops || 0) * Number(price || 0))} · +
          {Number(slops || 0) * 12} kok
        </p>
        <DialogFooter>
          <Button onClick={buy} disabled={pending} className="w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Catat pembelian"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ type }: { type: KokType }) {
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

  const bump = (delta: number) =>
    startTransition(async () => {
      const res = await adjustStockAction(type.id, delta);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  const del = () =>
    startTransition(async () => {
      if (!confirm(`Hapus jenis kok ${type.name}?`)) return;
      const res = await deleteKokTypeAction(type.id);
      if (res.ok) {
        toast.success("Jenis kok dihapus");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card className="gap-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{type.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatRupiah(type.pricePerPerson)}/org · slop {formatRupiah(type.pricePerSlop)}
          </p>
        </div>
        <Badge variant={type.stock > 0 ? "secondary" : "outline"} className="gap-1">
          <Package className="size-3" /> {type.stock}
        </Badge>
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" className="size-8" onClick={() => bump(-1)} disabled={pending}>
          <Minus className="size-4" />
        </Button>
        <Button size="icon" variant="outline" className="size-8" onClick={() => bump(1)} disabled={pending}>
          <Plus className="size-4" />
        </Button>
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

  const add = () =>
    startTransition(async () => {
      const stockN = stock ? Number(stock) : 0;
      const slopN = slop ? Number(slop) : 0;
      const res = await createKokTypeAction({
        name,
        pricePerPerson: Number(price),
        pricePerSlop: slopN,
        stock: stockN,
      });
      if (res.ok) {
        const expense =
          stockN > 0 && slopN > 0 ? Math.max(1, Math.ceil(stockN / 12)) * slopN : 0;
        toast.success(
          expense > 0
            ? `Jenis kok ditambah · kas keluar ${formatRupiah(expense)}`
            : "Jenis kok ditambah",
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
          Isi harga/slop + stok awal supaya kas keluar tercatat (1 slop = 12 kok).
        </p>
        <Input
          placeholder="Nama (cth. Indra Silver)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl"
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Harga/org"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            className="rounded-xl"
          />
          <Input
            placeholder="Harga/slop (beli)"
            inputMode="numeric"
            value={slop}
            onChange={(e) => setSlop(e.target.value.replace(/[^\d]/g, ""))}
            className="rounded-xl"
          />
        </div>
        <Input
          placeholder="Stok awal (pcs)"
          inputMode="numeric"
          value={stock}
          onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ""))}
          className="rounded-xl"
        />
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
