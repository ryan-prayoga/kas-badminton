"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { safeAction } from "@/lib/action-result";
import { adjustBalanceAction } from "@/server/actions/expenses";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BalancePanel() {
  const router = useRouter();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const amountN = Number(amount) || 0;

  const submit = () =>
    startTransition(async () => {
      if (!(amountN > 0)) {
        toast.error("Jumlah harus lebih dari 0");
        return;
      }
      const res = await safeAction(() =>
        adjustBalanceAction({ amount: amountN, direction, note: note.trim() || undefined }),
      );
      if (res.ok) {
        toast.success(
          direction === "in"
            ? `Saldo kas +${formatRupiah(amountN)}`
            : `Saldo kas −${formatRupiah(amountN)}`,
        );
        setAmount("");
        setNote("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
      <Card className="shrink-0 gap-3 rounded-xl2 p-4">
        <p className="text-sm font-semibold">Penyesuaian saldo</p>
        <p className="text-xs text-muted-foreground">
          Nambah modal, ambil kas, atau koreksi selisih — di luar beli stok kok.
        </p>

        <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
          <button
            type="button"
            onClick={() => setDirection("in")}
            className={
              "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition active:scale-[0.99] " +
              (direction === "in" ? "bg-court text-white" : "text-ink-soft hover:bg-surface-2")
            }
          >
            + Tambah
          </button>
          <button
            type="button"
            onClick={() => setDirection("out")}
            className={
              "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition active:scale-[0.99] " +
              (direction === "out" ? "bg-danger text-white" : "text-ink-soft hover:bg-surface-2")
            }
          >
            − Kurangi
          </button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bal-amount">Jumlah</Label>
          <Input
            id="bal-amount"
            placeholder="cth. 100000"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className="rounded-xl"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bal-note">Keterangan (opsional)</Label>
          <Input
            id="bal-note"
            placeholder="cth. modal awal, ambil buat konsumsi"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-xl"
          />
        </div>

        {amountN > 0 ? (
          <p className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground">
            Kas akan {direction === "in" ? "+" : "−"}
            {formatRupiah(amountN)}
          </p>
        ) : null}

        <Button onClick={submit} disabled={pending || !(amountN > 0)} className="w-full rounded-xl">
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Catat"}
        </Button>
      </Card>
    </div>
  );
}
