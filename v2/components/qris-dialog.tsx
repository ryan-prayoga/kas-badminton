"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function QrisDialog({
  name,
  defaultAmount,
  trigger,
}: {
  name: string;
  defaultAmount: number;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      toast.error("Nominal harus angka bulat > 0");
      return;
    }
    setLoading(true);
    setQr(null);
    try {
      const res = await fetch("/api/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal buat QRIS");
      const url = await QRCode.toDataURL(data.payload, { width: 320, margin: 1 });
      setQr(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal buat QRIS");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setAmount(String(defaultAmount || ""));
          setQr(null);
        }
      }}
    >
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : (
        <DialogTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" />}>
          <QrCode className="size-4" /> QRIS
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bayar QRIS — {name}</DialogTitle>
          <DialogDescription>
            Scan QR untuk bayar. Admin catat manual setelah dana masuk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qris-amount">Nominal</Label>
            <Input
              id="qris-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="cth. 12000"
            />
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QRIS" className="size-56" />
              <p className="tabular text-sm font-semibold text-neutral-900">
                {formatRupiah(Number(amount))}
              </p>
            </div>
          ) : (
            <Button onClick={generate} disabled={loading} className="w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Buat QR"}
            </Button>
          )}
          {qr && (
            <Button variant="outline" onClick={generate} disabled={loading} className="w-full">
              Buat ulang
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
