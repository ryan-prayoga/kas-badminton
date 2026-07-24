"use client";

import { useMemo, useState, useTransition } from "react";
import { KeyRound, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { PlayerRow } from "@/lib/domain/types";
import type { OperatorView } from "@/lib/repo/operators";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { createOperatorAction, revokeOperatorAction } from "@/server/actions/operators";
import { useConfirm } from "@/components/confirm-dialog";
import { buildPhotoMap } from "@/components/kok/avatar";
import { PlayerNameInput } from "@/components/kok/player-name-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DURATIONS = [
  { value: "1h", label: "1 jam" },
  { value: "2h", label: "2 jam" },
  { value: "3h", label: "3 jam" },
  { value: "6h", label: "6 jam" },
  { value: "12h", label: "12 jam" },
  { value: "1d", label: "1 hari" },
  { value: "3d", label: "3 hari" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "custom", label: "Custom tanggal…" },
] as const;

type DurationValue = (typeof DURATIONS)[number]["value"];

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function expiresAtFromDuration(duration: DurationValue, customDate: string): string | null {
  if (duration === "custom") {
    if (!customDate) return null;
    // Akhir hari lokal (parity v1)
    return new Date(`${customDate}T23:59:59`).toISOString();
  }
  const unit = duration.slice(-1);
  const amount = Number(duration.slice(0, -1));
  const ms = unit === "h" ? amount * 3_600_000 : amount * 86_400_000;
  return new Date(Date.now() + ms).toISOString();
}

function durationLabel(value: string | null): string {
  return DURATIONS.find((d) => d.value === value)?.label ?? "7 hari";
}

export function OperatorsPanel({
  operators,
  players,
}: {
  operators: OperatorView[];
  players: PlayerRow[];
}) {
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState<DurationValue>("7d");
  const [customDate, setCustomDate] = useState(todayLocal());
  const [pin, setPin] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const photoMap = useMemo(() => buildPhotoMap(players), [players]);
  const playerNames = useMemo(() => players.map((p) => p.name), [players]);
  const active = useMemo(() => operators.filter((op) => op.active), [operators]);

  const previewExpiry = useMemo(
    () => expiresAtFromDuration(duration, customDate),
    [duration, customDate],
  );

  const create = () =>
    startTransition(async () => {
      const expiresAt = expiresAtFromDuration(duration, customDate);
      if (!expiresAt) {
        toast.error("Isi tanggal kadaluarsa");
        return;
      }
      const res = await createOperatorAction({ name, expiresAt });
      if (res.ok) {
        setPin(res.data.pin);
        setName("");
        setDuration("7d");
        setCustomDate(todayLocal());
        toast.success("Delegasi dibuat");
      } else {
        toast.error(res.error);
      }
    });

  const revoke = async (id: string, n: string) => {
    const ok = await confirm({
      title: "Cabut delegasi?",
      message: `Cabut akses delegasi "${n}"? Sesi yang lagi login langsung ke-logout.`,
      confirmLabel: "Ya, cabut",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await revokeOperatorAction(id);
      if (res.ok) toast.success("Delegasi dicabut");
      else toast.error(res.error);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* overflow-visible: dropdown pilih pemain gak kepotong */}
      <Card className="relative z-20 shrink-0 gap-3 overflow-visible p-4">
        <p className="text-sm font-semibold">Buat delegasi (operator sementara)</p>

        <div className="space-y-1.5">
          <Label htmlFor="op-name">Nama</Label>
          <PlayerNameInput
            value={name}
            onChange={setName}
            names={playerNames}
            photoMap={photoMap}
            placeholder="Nama delegasi (manual atau pilih pemain)"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Masa aktif</Label>
          <Select
            value={duration}
            onValueChange={(v) => setDuration((v as DurationValue) || "7d")}
          >
            <SelectTrigger className="h-10 w-full rounded-xl border-input bg-surface px-3">
              <SelectValue>{(v: string | null) => durationLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl" alignItemWithTrigger={false}>
              {DURATIONS.map((d) => (
                <SelectItem key={d.value} value={d.value} className="rounded-lg">
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {duration === "custom" && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="op-custom-date">Sampai tanggal</Label>
              <Input
                id="op-custom-date"
                type="date"
                min={todayLocal()}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-10 rounded-xl bg-surface"
              />
              {customDate && (
                <p className="text-xs text-muted-foreground">
                  Aktif sampai {fmtDate(customDate)}, 23.59
                </p>
              )}
            </div>
          )}

          {duration !== "custom" && previewExpiry && (
            <p className="text-xs text-muted-foreground">
              Aktif sampai {fmtDateTime(previewExpiry)}
            </p>
          )}
        </div>

        <Button onClick={create} disabled={pending || !name.trim()} className="w-full gap-1.5">
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-3 p-px">
          {active.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Belum ada delegasi aktif.</p>
          ) : (
            active.map((op) => (
              <Card key={op.id} className="flex-row items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium">{op.name}</p>
                    <Badge variant="secondary" className="text-brand">
                      aktif
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">sampai {fmtDateTime(op.expiresAt)}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => revoke(op.id, op.name)}
                  disabled={pending}
                  title="Cabut"
                >
                  <X className="size-4" />
                </Button>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
