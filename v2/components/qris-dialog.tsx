"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah, formatThousands } from "@/lib/format";
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
import { KIcon } from "@/components/kok/icons";

const pillBtn =
  "inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-card transition active:scale-95";

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
  const [qr, setQr] = useState<{ url: string; amount: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const amt = Number(amount);
  const validAmount = Number.isInteger(amt) && amt > 0;

  const generate = async () => {
    if (!validAmount) {
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
      setQr({ url, amount: amt });
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
        <DialogTrigger render={<button type="button" className={pillBtn} />}>
          <KIcon name="qrcode" className="size-4" /> QRIS
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
              value={formatThousands(amount)}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d]/g, ""));
                // QR yang sudah dibuat jadi basi begitu nominal diubah — buang biar wajib generate ulang.
                setQr(null);
              }}
              placeholder="cth. 12.000"
            />
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.url} alt="QRIS" className="size-56" />
              <p className="tabular text-sm font-semibold text-neutral-900">
                {formatRupiah(qr.amount)}
              </p>
            </div>
          ) : (
            <Button onClick={generate} disabled={loading || !validAmount} className="w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Buat QR"}
            </Button>
          )}
          {qr && (
            <Button
              variant="outline"
              onClick={generate}
              disabled={loading || !validAmount}
              className="w-full"
            >
              Buat ulang
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
