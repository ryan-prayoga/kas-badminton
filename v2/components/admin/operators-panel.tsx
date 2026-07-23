"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { OperatorView } from "@/lib/repo/operators";
import { createOperatorAction, revokeOperatorAction } from "@/server/actions/operators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function defaultExpiry(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function OperatorsPanel({ operators }: { operators: OperatorView[] }) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState(defaultExpiry());
  const [pin, setPin] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const res = await createOperatorAction({
        name,
        expiresAt: new Date(expiry).toISOString(),
      });
      if (res.ok) {
        setPin(res.data.pin);
        setName("");
        toast.success("Delegasi dibuat");
      } else {
        toast.error(res.error);
      }
    });

  const revoke = (id: string, n: string) =>
    startTransition(async () => {
      if (!confirm(`Cabut delegasi ${n}?`)) return;
      const res = await revokeOperatorAction(id);
      if (res.ok) toast.success("Delegasi dicabut");
      else toast.error(res.error);
    });

  return (
    <div className="space-y-3">
      <Card className="gap-3 p-4">
        <p className="text-sm font-semibold">Buat delegasi (operator sementara)</p>
        <Input placeholder="Nama operator" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="space-y-1.5">
          <Label htmlFor="exp">Aktif sampai</Label>
          <Input
            id="exp"
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </div>
        <Button onClick={create} disabled={pending || !name} className="w-full gap-1.5">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          Buat & tampilkan PIN
        </Button>

        {pin && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand/12 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-brand" />
              <div>
                <p className="text-xs text-muted-foreground">PIN operator (sekali tampil)</p>
                <p className="tabular text-lg font-bold tracking-widest text-brand">{pin}</p>
              </div>
            </div>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setPin(null)}>
              <X className="size-4" />
            </Button>
          </div>
        )}
      </Card>

      {operators.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Belum ada delegasi.</p>
      ) : (
        operators.map((op) => (
          <Card key={op.id} className="flex-row items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{op.name}</p>
              <p className="text-xs text-muted-foreground">
                sampai {new Date(op.expiresAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            {op.active ? (
              <>
                <Badge variant="secondary" className="text-brand">
                  aktif
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => revoke(op.id, op.name)}
                  disabled={pending}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {op.revokedAt ? "dicabut" : "kadaluarsa"}
              </Badge>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
