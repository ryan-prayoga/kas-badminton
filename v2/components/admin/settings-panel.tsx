"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSettingsAction } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPanel({
  defaultPrice,
  merchantQris,
}: {
  defaultPrice: number;
  merchantQris: string;
}) {
  const [price, setPrice] = useState(String(defaultPrice));
  const [qris, setQris] = useState(merchantQris);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const res = await updateSettingsAction({
        defaultPricePerPerson: Number(price),
        merchantQris: qris.trim(),
      });
      if (res.ok) toast.success("Pengaturan disimpan");
      else toast.error(res.error);
    });

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="dpp">Harga default per orang / kok</Label>
        <Input
          id="dpp"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="qris">QRIS statis merchant</Label>
        <textarea
          id="qris"
          rows={4}
          value={qris}
          onChange={(e) => setQris(e.target.value)}
          placeholder="Tempel payload QRIS statis (decode dari QR cetak)…"
          className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand/30"
        />
        <p className="text-xs text-muted-foreground">
          Sekali diset, tombol “Bayar QRIS” muncul di kartu tagihan.
        </p>
      </div>
      <Button onClick={save} disabled={pending} className="w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Simpan pengaturan"}
      </Button>
    </Card>
  );
}
