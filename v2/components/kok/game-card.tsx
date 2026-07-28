"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { EnrichedGame, KokType, PlayerRow } from "@/lib/domain/types";
import { fmt, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteGameAction, markAllPaidAction, setPaidAction } from "@/server/actions/games";
import { useConfirm } from "@/components/confirm-dialog";
import type { PhotoMap } from "@/components/kok/avatar";
import { KIcon } from "@/components/kok/icons";
import { AddKokDialog } from "@/components/kok/add-kok-dialog";
import { EditGameSheet } from "@/components/kok/edit-game-sheet";
import { safeAction } from "@/lib/action-result";

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
  paidAt,
  paidBy,
  editable,
  pending,
  onToggle,
  align,
}: {
  indexes: number[];
  names: string[];
  paid: boolean[];
  paidAt: (string | undefined)[];
  paidBy: (string | undefined)[];
  editable: boolean;
  pending: boolean;
  onToggle: (i: number) => void;
  align: "left" | "right";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", align === "left" ? "pr-3.5" : "pl-3.5")}>
      {indexes.map((i) => {
        const isPaid = paid[i];
        const at = isPaid ? paidAt[i] : undefined;
        const by = isPaid ? paidBy[i] : undefined;
        const Tag = editable ? "button" : "div";
        const title = at
          ? `${names[i] || "—"} · lunas ${fmtDateTime(at)}${by ? ` oleh ${by}` : ""}`
          : names[i] || undefined;
        return (
          <Tag
            key={i}
            {...(editable ? { type: "button" as const, onClick: () => onToggle(i), disabled: pending } : {})}
            className={cn(
              // box-border + w-full: border gak kepotong di grid sempit
              "box-border flex w-full min-w-0 items-center gap-1.5 rounded-lg border px-2 py-2 text-left",
              isPaid
                ? "border-paid/40 bg-paid/10 text-paid"
                : "border-owe/40 bg-owe/10 text-owe",
              // target sentuh ≥44px saat chip jadi tombol toggle
              editable && "min-h-11 transition active:scale-[0.98] disabled:opacity-60",
            )}
          >
            <KIcon
              name={isPaid ? "checkCircle" : "clock"}
              className="size-[15px] shrink-0"
            />
            {/* Kapan-nya cukup di halaman History bayar — di sini nama saja (tooltip tetap bawa detail). */}
            <span className="flex min-w-0 flex-1 flex-col" title={title}>
              <span className="truncate text-sm font-semibold leading-tight text-ink">
                {names[i] || "—"}
              </span>
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
  onPaidChange,
}: {
  game: EnrichedGame;
  photoMap: PhotoMap;
  editable?: boolean;
  flash?: boolean;
  kokTypes?: KokType[];
  players?: PlayerRow[];
  defaultPrice?: number;
  /** Lapor jumlah "belum bayar" optimistik ke parent biar badge grup sinkron dgn kartu. */
  onPaidChange?: (gameId: string, unpaidCount: number) => void;
}) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [paid, setPaid] = useState(() => game.players.map((p) => p.paid));

  // resync dari server (realtime / setelah mutasi) via pola reset-saat-render:
  // begitu updatedAt berubah, buang state optimistik dan ikut data server terbaru.
  const [syncedAt, setSyncedAt] = useState(game.updatedAt);
  if (syncedAt !== game.updatedAt) {
    setSyncedAt(game.updatedAt);
    setPaid(game.players.map((p) => p.paid));
  }

  const names = game.players.map((p) => p.name);
  const paidAt = game.players.map((p) => p.paidAt);
  const paidBy = game.players.map((p) => p.paidBy);
  const allPaid = paid.every(Boolean);
  const unpaidCount = paid.filter((x) => !x).length;

  // Header grup pakai hitungan ini juga — kabari tiap kali state paid berubah.
  useEffect(() => {
    onPaidChange?.(game.id, unpaidCount);
  }, [onPaidChange, game.id, unpaidCount]);

  const toggle = (index: number) => {
    if (!editable) return;
    const next = [...paid];
    next[index] = !next[index];
    setPaid(next); // optimistic
    start(async () => {
      const res = await safeAction(() => setPaidAction(game.id, index, next[index]));
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
      const res = await safeAction(() => markAllPaidAction(game.id, true));
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
      const res = await safeAction(() => deleteGameAction(game.id));
      if (res.ok) toast.success("Game dihapus");
      else toast.error(res.error);
    });
  };

  return (
    <div
      className={cn(
        // border di dalam box-model (bukan ring) biar gak kepotong overflow parent
        // min-w-0: kartu ini item grid; tanpa ini `min-width: auto` bikin dia melar
        // ke min-content (363px) dan kepotong di layar 375px (iPhone SE/mini)
        "min-w-0 rounded-xl2 border border-line bg-surface p-3 shadow-card",
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

      {/* signature: mini court — overflow-visible biar border chip gak kepotong */}
      <div className="court-surface relative mt-2.5 overflow-visible rounded-xl border border-court/20 p-2">
        <div className="court-net pointer-events-none absolute inset-y-4 left-1/2 z-0 w-[2px] -translate-x-1/2" />
        <span className="font-display pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-court/30 bg-surface px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-court shadow-sm">
          VS
        </span>
        <div className="relative z-[1] grid grid-cols-2 gap-x-1">
          <CourtSide
            indexes={[0, 1]}
            names={names}
            paid={paid}
            paidAt={paidAt}
            paidBy={paidBy}
            editable={editable}
            pending={pending}
            onToggle={toggle}
            align="left"
          />
          <CourtSide
            indexes={[2, 3]}
            names={names}
            paid={paid}
            paidAt={paidAt}
            paidBy={paidBy}
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
          <span className="truncate">{game.recordedBy || "Admin"}</span>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            {!allPaid && (
              <button
                type="button"
                onClick={markAll}
                disabled={pending}
                aria-label="Centang semua"
                className="grid size-10 place-items-center rounded-lg text-court transition hover:bg-court/10 disabled:opacity-40"
              >
                <KIcon name="checkAll" className="size-4" />
              </button>
            )}
            {kokTypes && (
              <AddKokDialog game={game} kokTypes={kokTypes} defaultPrice={defaultPrice ?? 0} disabled={pending} />
            )}
            {kokTypes && players && defaultPrice !== undefined && (
              <EditGameSheet
                game={game}
                kokTypes={kokTypes}
                players={players}
                defaultPrice={defaultPrice}
                disabled={pending}
              />
            )}
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-label="Hapus game"
              className="grid size-10 place-items-center rounded-lg text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
            >
              <KIcon name="trash" className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
