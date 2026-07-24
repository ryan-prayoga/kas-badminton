"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { EnrichedGame, KokType, PlayerRow } from "@/lib/domain/types";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteGameAction, markAllPaidAction, setPaidAction } from "@/server/actions/games";
import { useConfirm } from "@/components/confirm-dialog";
import type { PhotoMap } from "@/components/kok/avatar";
import { KIcon } from "@/components/kok/icons";
import { EditGameSheet } from "@/components/kok/edit-game-sheet";

function kokSummaryLabel(g: EnrichedGame): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const k of g.koks) {
    const n = k.typeName ? String(k.typeName).trim() : "";
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  const base = `${g.cost.kokCount} kok · ${fmt(g.cost.perPerson)}/org`;
  if (!names.length) return base;
  if (names.length === 1) return `${base} · ${names[0]}`;
  return `${base} · ${names.length} jenis`;
}

function CourtSide({
  indexes,
  names,
  paid,
  editable,
  pending,
  onToggle,
  align,
}: {
  indexes: number[];
  names: string[];
  paid: boolean[];
  editable: boolean;
  pending: boolean;
  onToggle: (i: number) => void;
  align: "left" | "right";
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", align === "left" ? "pr-4" : "pl-4")}>
      {indexes.map((i) => {
        const isPaid = paid[i];
        const Tag = editable ? "button" : "div";
        return (
          <Tag
            key={i}
            {...(editable ? { type: "button" as const, onClick: () => onToggle(i), disabled: pending } : {})}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-2 text-left backdrop-blur-sm",
              isPaid
                ? "border-paid/25 bg-paid/10 text-paid"
                : "border-owe/25 bg-owe/10 text-owe",
              editable && "transition active:scale-[0.98] disabled:opacity-60",
            )}
          >
            <KIcon
              name={isPaid ? "checkCircle" : "clock"}
              className="size-[15px] shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {names[i] || "—"}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}

export function GameCard({
  game,
  editable = false,
  flash = false,
  kokTypes,
  players,
  defaultPrice,
}: {
  game: EnrichedGame;
  photoMap: PhotoMap;
  editable?: boolean;
  flash?: boolean;
  kokTypes?: KokType[];
  players?: PlayerRow[];
  defaultPrice?: number;
}) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [paid, setPaid] = useState(() => game.players.map((p) => p.paid));

  // resync dari server (realtime / setelah mutasi)
  useEffect(() => {
    setPaid(game.players.map((p) => p.paid));
  }, [game.updatedAt, game.players]);

  const names = game.players.map((p) => p.name);
  const allPaid = paid.every(Boolean);
  const unpaidCount = paid.filter((x) => !x).length;

  const toggle = (index: number) => {
    if (!editable) return;
    const next = [...paid];
    next[index] = !next[index];
    setPaid(next); // optimistic
    start(async () => {
      const res = await setPaidAction(game.id, index, next[index]);
      if (!res.ok) {
        setPaid(game.players.map((p) => p.paid));
        toast.error(res.error);
      }
    });
  };

  const markAll = async () => {
    const ok = await confirm({
      title: "Lunasin semua?",
      message: `Tandai SEMUA pemain di game ini sudah bayar (${unpaidCount} belum lunas)?`,
      confirmLabel: "Ya, lunasin",
      destructive: false,
    });
    if (!ok) return;
    start(async () => {
      setPaid(paid.map(() => true));
      const res = await markAllPaidAction(game.id, true);
      if (res.ok) toast.success("Ditandai lunas semua");
      else {
        setPaid(game.players.map((p) => p.paid));
        toast.error(res.error);
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Hapus game?",
      message: "Game ini dihapus permanen. Stok kok dikembalikan. Data tidak bisa dikembalikan.",
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteGameAction(game.id);
      if (res.ok) toast.success("Game dihapus");
      else toast.error(res.error);
    });
  };

  return (
    <div
      className={cn(
        "rounded-xl2 border border-line bg-surface p-3 shadow-card",
        flash && "flash-update",
        pending && "opacity-80",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          <KIcon name="shuttle" className="size-3.5 shrink-0 text-ink-faint" />
          <span className="truncate">{kokSummaryLabel(game)}</span>
        </div>
        {allPaid ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paid/12 px-2 py-0.5 text-[11px] font-bold text-paid">
            <KIcon name="checkCircle" className="size-3" /> Lunas
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-owe/12 px-2 py-0.5 text-[11px] font-bold text-owe">
            <KIcon name="alert" className="size-3" /> {unpaidCount} belum
          </span>
        )}
      </div>

      {/* signature: mini court */}
      <div className="court-surface relative mt-2.5 rounded-xl border border-court/15 p-2.5">
        <div className="court-net pointer-events-none absolute inset-y-4 left-1/2 w-[2px] -translate-x-1/2" />
        <span className="font-display pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-court/25 bg-surface px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-court shadow-sm">
          VS
        </span>
        <div className="grid grid-cols-2">
          <CourtSide
            indexes={[0, 1]}
            names={names}
            paid={paid}
            editable={editable}
            pending={pending}
            onToggle={toggle}
            align="left"
          />
          <CourtSide
            indexes={[2, 3]}
            names={names}
            paid={paid}
            editable={editable}
            pending={pending}
            onToggle={toggle}
            align="right"
          />
        </div>
      </div>

      {game.notes && (
        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-ink-soft">
          <KIcon name="pencil" className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
          <span className="min-w-0">{game.notes}</span>
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-ink-faint">
          <KIcon name="pencil" className="size-3 shrink-0" />
          <span className="truncate">dicatat {game.recordedBy || "Admin"}</span>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            {!allPaid && (
              <button
                type="button"
                onClick={markAll}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-court transition hover:bg-court/8"
              >
                <KIcon name="check" className="size-3.5" /> Lunasin semua
              </button>
            )}
            {kokTypes && players && defaultPrice !== undefined && (
              <EditGameSheet
                game={game}
                kokTypes={kokTypes}
                players={players}
                defaultPrice={defaultPrice}
              />
            )}
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-label="Hapus game"
              className="grid size-8 place-items-center rounded-lg text-ink-faint transition hover:bg-danger/10 hover:text-danger"
            >
              <KIcon name="trash" className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
