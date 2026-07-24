"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { DebtEntry, DebtItem } from "@/lib/domain/types";
import { fmt, fmtDate, relativeDay } from "@/lib/format";
import type { ShareCardBlock } from "@/lib/share";
import { cn } from "@/lib/utils";
import { payInstallmentAction, settleAllAction } from "@/server/actions/players";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { ShareChoiceDialog } from "@/components/kok/share-choice";
import { KIcon } from "@/components/kok/icons";
import { QrisDialog } from "@/components/qris-dialog";

interface DateGroup {
  date: string;
  total: number;
  count: number;
  koks: number;
}

function groupItems(items: DebtItem[]): DateGroup[] {
  const map = new Map<string, DateGroup>();
  const order: string[] = [];
  for (const it of items) {
    let g = map.get(it.date);
    if (!g) {
      g = { date: it.date, total: 0, count: 0, koks: 0 };
      map.set(it.date, g);
      order.push(it.date);
    }
    g.total += Number(it.amount) || 0;
    g.count += 1;
    g.koks += Number(it.kokCount) || 0;
  }
  return order.map((d) => map.get(d)!);
}

function debtShareText(d: DebtEntry): string {
  const lines = [`Tagihan kok badminton — ${d.name}`, `Sisa: ${fmt(d.total)}`];
  if (d.carry > 0) lines.push(`(sudah dicicil ${fmt(d.carry)} dari ${fmt(d.owedGross)})`);
  for (const g of groupItems(d.items)) lines.push(`• ${fmtDate(g.date)} — ${fmt(g.total)} (${g.count} main)`);
  return lines.join("\n");
}

function debtShareBlocks(d: DebtEntry): ShareCardBlock[] {
  const grouped = groupItems(d.items);
  const blocks: ShareCardBlock[] = [
    { kind: "header", title: d.name, subtitle: "Tagihan belum lunas" },
    { kind: "kv", label: "Sisa tagihan", value: fmt(d.total), tone: "owe" },
  ];
  if (d.carry > 0) {
    blocks.push({
      kind: "kv",
      label: "Sudah dicicil",
      value: `${fmt(d.carry)} / ${fmt(d.owedGross)}`,
      tone: "paid",
    });
  }
  blocks.push({ kind: "section", title: "Rincian main" });
  for (const g of grouped) {
    blocks.push({
      kind: "person",
      rank: 0,
      name: fmtDate(g.date),
      detail: `${g.count} main · ${g.koks} kok`,
      right: fmt(g.total),
      rightTone: "owe",
    });
  }
  // Fix rank display: use index 1..n
  let i = 0;
  for (const b of blocks) {
    if (b.kind === "person") {
      i += 1;
      b.rank = i;
    }
  }
  blocks.push({ kind: "footer", text: "kok.ryanprayoga.dev" });
  return blocks;
}

function rekapShareText(debts: DebtEntry[], total: number): string {
  if (!debts.length) return "Semua sudah lunas 🎉";
  const lines = ["Rekap tagihan kok badminton", `Total belum bayar: ${fmt(total)}`, ""];
  for (const d of debts) lines.push(`• ${d.name}: ${fmt(d.total)}`);
  return lines.join("\n");
}

function rekapShareBlocks(debts: DebtEntry[], total: number): ShareCardBlock[] {
  const blocks: ShareCardBlock[] = [
    { kind: "header", title: "Rekap tagihan", subtitle: "Belum bayar" },
    {
      kind: "kv",
      label: "Total belum bayar",
      value: fmt(total),
      tone: total > 0 ? "owe" : "paid",
    },
    { kind: "section", title: `Orang (${debts.length})` },
  ];
  if (!debts.length) {
    blocks.push({ kind: "kv", label: "Status", value: "Semua lunas 🎉", tone: "paid" });
  } else {
    debts.forEach((d, i) => {
      const koks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: d.name,
        detail: `${d.items.length} main · ${koks} kok`,
        right: fmt(d.total),
        rightTone: "owe",
      });
    });
  }
  blocks.push({ kind: "footer", text: "kok.ryanprayoga.dev" });
  return blocks;
}

function DebtCard({
  d,
  photoMap,
  editable,
  qrisEnabled,
}: {
  d: DebtEntry;
  photoMap: PhotoMap;
  editable: boolean;
  qrisEnabled: boolean;
}) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cicil, setCicil] = useState(false);
  const [amount, setAmount] = useState("");
  const grouped = groupItems(d.items);
  const totalKoks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
  const shareTextPayload = useMemo(() => debtShareText(d), [d]);
  const shareBlocks = useMemo(() => debtShareBlocks(d), [d]);

  const settle = async () => {
    const ok = await confirm({
      title: "Lunasin semua?",
      message: `Lunasin SEMUA tagihan ${d.name} (${fmt(d.total)})? Semua game-nya ditandai bayar.`,
      confirmLabel: "Ya, lunasin",
      destructive: false,
    });
    if (!ok) return;
    start(async () => {
      const res = await settleAllAction(d.name);
      if (res.ok) toast.success(`${d.name} lunas`);
      else toast.error(res.error);
    });
  };

  const pay = () => {
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) return toast.error("Nominal harus lebih dari 0");
    start(async () => {
      const res = await payInstallmentAction(d.name, amt);
      if (res.ok) {
        toast.success(`Cicilan ${d.name} tercatat`);
        setCicil(false);
        setAmount("");
      } else toast.error(res.error);
    });
  };

  return (
    <div className={cn("animate-rise overflow-hidden rounded-xl2 border border-owe/25 bg-owe/[0.05]", pending && "opacity-80")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full select-none items-center justify-between gap-3 p-3.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={d.name} photo={photoMap[d.name]} tone="owe" />
          <div className="min-w-0">
            <div className="font-display truncate font-bold text-ink">{d.name}</div>
            <div className="inline-flex items-center gap-2.5 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <KIcon name="racket" className="size-3.5" /> {d.items.length} main
              </span>
              <span className="inline-flex items-center gap-1">
                <KIcon name="shuttle" className="size-3" /> {totalKoks} kok
              </span>
            </div>
            {d.carry > 0 && (
              <div className="mt-0.5 text-[11px] font-medium text-paid">
                dicicil {fmt(d.carry)} / {fmt(d.owedGross)}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular font-mono text-base font-bold text-owe">{fmt(d.total)}</span>
          <KIcon
            name="chevronDown"
            className={cn("size-5 text-ink-faint transition-transform duration-200", open && "rotate-180")}
          />
        </div>
      </button>

      <div className="acc-panel" data-open={open}>
        <div className="acc-inner">
          <div className="px-3.5 pb-3.5">
            <div className="grid gap-px overflow-hidden rounded-xl border border-owe/15 bg-surface">
              {grouped.map((g) => {
                const rel = relativeDay(g.date);
                return (
                  <div key={g.date} className="bg-surface px-3 py-2 odd:bg-surface-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-soft">
                        <KIcon name="calendar" className="size-3.5 shrink-0 text-ink-faint" />
                        <span className="truncate">{fmtDate(g.date)}</span>
                      </span>
                      <span className="tabular shrink-0 font-mono text-sm font-bold text-owe">{fmt(g.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-faint">
                      <span className="flex items-center gap-1">
                        <KIcon name="racket" className="size-3.5" /> {g.count} main
                      </span>
                      <span className="flex items-center gap-1">
                        <KIcon name="shuttle" className="size-3" /> {g.koks} kok
                      </span>
                      {rel && (
                        <span className="rounded-full bg-court/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-court">
                          {rel}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {qrisEnabled && <QrisDialog name={d.name} defaultAmount={d.total} />}
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-card transition active:scale-95"
              >
                <KIcon name="share" className="size-4" /> Bagikan
              </button>
              <ShareChoiceDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                title={`Bagikan · ${d.name}`}
                description="Pilih format teks atau gambar"
                text={shareTextPayload}
                imageBlocks={shareBlocks}
                imageName={`tagihan-${d.name.toLowerCase().replace(/\s+/g, "-")}.png`}
              />
              {editable && (
                <>
                  {!cicil ? (
                    <button
                      type="button"
                      onClick={() => setCicil(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-card transition active:scale-95"
                    >
                      <KIcon name="cash" className="size-4" /> Cicil
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        inputMode="numeric"
                        autoFocus
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder={`maks ${d.total}`}
                        className="w-28 rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50"
                      />
                      <button
                        type="button"
                        onClick={pay}
                        disabled={pending}
                        className="grid size-9 place-items-center rounded-xl bg-court text-white shadow-court transition active:scale-95"
                      >
                        <KIcon name="check" className="size-4" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={settle}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-paid px-3 py-2 text-sm font-semibold text-white shadow-card transition active:scale-95"
                  >
                    <KIcon name="checkCircle" className="size-4" /> Lunasin
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DebtView({
  debts,
  photoMap,
  editable = false,
  qrisEnabled = false,
}: {
  debts: DebtEntry[];
  photoMap: PhotoMap;
  editable?: boolean;
  qrisEnabled?: boolean;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const total = debts.reduce((s, d) => s + d.total, 0);
  const shareTextPayload = useMemo(() => rekapShareText(debts, total), [debts, total]);
  const shareBlocks = useMemo(() => rekapShareBlocks(debts, total), [debts, total]);

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-owe/12 text-owe">
            <KIcon name="wallet" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Belum bayar</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {debts.length > 0 && (
            <span className="tabular inline-flex items-center gap-1 font-mono text-sm font-bold text-owe">
              {fmt(total)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Bagikan semua tagihan"
            className="grid size-8 place-items-center rounded-xl border border-line bg-surface text-ink-soft shadow-card transition hover:text-court active:scale-95"
          >
            <KIcon name="share" className="size-4" />
          </button>
        </div>
      </div>

      <ShareChoiceDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Bagikan rekap"
        description="Semua tagihan belum bayar"
        text={shareTextPayload}
        imageBlocks={shareBlocks}
        imageName="rekap-belum-bayar.png"
      />

      {debts.length === 0 ? (
        <EmptyPanel icon="happy" text="Semua sudah bayar 🎉" />
      ) : (
        <div className="flex flex-col gap-3">
          {debts.map((d) => (
            <DebtCard key={d.name} d={d} photoMap={photoMap} editable={editable} qrisEnabled={qrisEnabled} />
          ))}
        </div>
      )}
    </section>
  );
}
