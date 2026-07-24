"use client";

import { useMemo, useState } from "react";
import type { DebtEntry, EnrichedGame, ExpenseRow, KokType } from "@/lib/domain/types";
import { fmt, periodKey, periodLabel } from "@/lib/format";
import type { ShareCardBlock } from "@/lib/share";
import { cn } from "@/lib/utils";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { PeriodFilter } from "@/components/kok/period-filter";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { ShareChoiceDialog } from "@/components/kok/share-choice";
import { KIcon, type IconName } from "@/components/kok/icons";

function StatCard({
  icon,
  iconClass,
  label,
  value,
  valueClass,
  sub,
}: {
  icon: IconName;
  iconClass: string;
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="animate-rise rounded-xl2 border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        <KIcon name={icon} className={cn("size-4", iconClass)} />
        {label}
      </div>
      <div className={cn("font-display tabular mt-1.5 text-2xl font-extrabold tracking-tight text-ink", valueClass)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

interface PlayerStat {
  name: string;
  main: number;
  kok: number;
  keluar: number;
  nunggak: number;
}

function buildStatsShareText({
  periodName,
  totalGames,
  totalKok,
  paid,
  unpaid,
  expense,
  showKas,
  players,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
}): string {
  const net = paid - expense;
  const lines: string[] = [
    "📊 Statistik Kok Badminton",
    `Periode: ${periodName}`,
    "",
    "RINGKASAN",
    `• Total game: ${totalGames}`,
    `• Total kok: ${totalKok}`,
    `• Masuk (lunas): ${fmt(paid)}`,
    `• Belum bayar: ${fmt(unpaid)}`,
  ];

  if (showKas) {
    lines.push(`• Keluar (beli stok): ${fmt(expense)}`);
    lines.push(`• Saldo bersih: ${fmt(net)}`);
  }

  lines.push("", `PEMAIN (${players.length} orang)`);
  if (players.length === 0) {
    lines.push("• Belum ada yang main");
  } else {
    players.forEach((p, i) => {
      const status = p.nunggak > 0 ? `nunggak ${fmt(p.nunggak)}` : "Lunas";
      lines.push(
        `${i + 1}. ${p.name} — ${p.main} main · ${p.kok} kok · keluar ${fmt(p.keluar)} · ${status}`,
      );
    });
  }

  return lines.join("\n");
}

function buildStatsShareBlocks({
  periodName,
  totalGames,
  totalKok,
  paid,
  unpaid,
  expense,
  showKas,
  players,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
}): ShareCardBlock[] {
  const net = paid - expense;
  const blocks: ShareCardBlock[] = [
    { kind: "header", title: "Statistik", subtitle: periodName },
    { kind: "section", title: "Ringkasan" },
    { kind: "kv", label: "Total game", value: String(totalGames) },
    { kind: "kv", label: "Total kok", value: String(totalKok) },
    { kind: "kv", label: "Masuk (lunas)", value: fmt(paid), tone: "paid" },
    {
      kind: "kv",
      label: "Belum bayar",
      value: fmt(unpaid),
      tone: unpaid > 0 ? "owe" : "paid",
    },
  ];

  if (showKas) {
    blocks.push(
      { kind: "kv", label: "Keluar (beli stok)", value: fmt(expense), tone: "danger" },
      {
        kind: "kv",
        label: "Saldo bersih",
        value: fmt(net),
        tone: net >= 0 ? "paid" : "danger",
      },
    );
  }

  blocks.push({ kind: "section", title: `Pemain (${players.length})` });
  if (players.length === 0) {
    blocks.push({ kind: "kv", label: "Status", value: "Belum ada yang main", tone: "muted" });
  } else {
    for (const [i, p] of players.entries()) {
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: p.name,
        detail: `${p.main} main · ${p.kok} kok · ${fmt(p.keluar)}`,
        right: p.nunggak > 0 ? fmt(p.nunggak) : "Lunas",
        rightTone: p.nunggak > 0 ? "owe" : "paid",
      });
    }
  }

  blocks.push({ kind: "footer", text: "kok.ryanprayoga.dev" });
  return blocks;
}

export function StatsView({
  games,
  debts,
  kokTypes,
  photoMap,
  kas,
  expenses,
}: {
  games: EnrichedGame[];
  debts: DebtEntry[];
  kokTypes: KokType[];
  photoMap: PhotoMap;
  kas?: { paid: number; expense: number; net: number };
  expenses?: ExpenseRow[];
}) {
  const [period, setPeriod] = useState("all");
  const [shareOpen, setShareOpen] = useState(false);

  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [games]);

  const scoped = useMemo(
    () => (period === "all" ? games : games.filter((g) => periodKey(g.date) === period)),
    [games, period],
  );

  const totalKok = scoped.reduce((s, g) => s + g.cost.kokCount, 0);
  const paidIn = scoped.reduce((s, g) => s + g.summary.paidTotal, 0);
  const unpaidIn = scoped.reduce((s, g) => s + g.summary.unpaidTotal, 0);

  const expenseIn = useMemo(() => {
    if (!kas) return 0;
    if (period === "all") return kas.expense;
    if (!expenses?.length) return 0;
    return expenses
      .filter((e) => periodKey(e.createdAt.slice(0, 10)) === period)
      .reduce((s, e) => s + e.amount, 0);
  }, [kas, expenses, period]);

  const kasNet = paidIn - expenseIn;
  const stockLeft = kokTypes.reduce((s, t) => s + Math.max(0, Number(t.stock) || 0), 0);
  const typesWithStock = kokTypes.filter((t) => (Number(t.stock) || 0) > 0).length;

  const totalDebt =
    period === "all" ? debts.reduce((s, d) => s + d.total, 0) : unpaidIn;
  const debtPeople =
    period === "all"
      ? debts.length
      : new Set(
          scoped.flatMap((g) => g.players.filter((p) => p.name && !p.paid).map((p) => p.name)),
        ).size;

  const players = useMemo(() => {
    const map = new Map<string, PlayerStat>();
    for (const g of scoped) {
      const kokCount = Number(g.cost.kokCount) || 0;
      for (const p of g.players) {
        if (!p.name) continue;
        const s = map.get(p.name) ?? { name: p.name, main: 0, kok: 0, keluar: 0, nunggak: 0 };
        s.main += 1;
        s.kok += kokCount;
        s.keluar += g.cost.perPerson;
        if (!p.paid) s.nunggak += g.cost.perPerson;
        map.set(p.name, s);
      }
    }
    return [...map.values()].sort(
      (a, b) => b.nunggak - a.nunggak || b.main - a.main || a.name.localeCompare(b.name, "id"),
    );
  }, [scoped]);

  const periodName = period === "all" ? "Semua waktu" : periodLabel(period);

  const sharePayload = useMemo(() => {
    const args = {
      periodName,
      totalGames: scoped.length,
      totalKok,
      paid: paidIn,
      unpaid: totalDebt,
      expense: expenseIn,
      showKas: Boolean(kas),
      players,
    };
    return {
      text: buildStatsShareText(args),
      blocks: buildStatsShareBlocks(args),
    };
  }, [periodName, scoped.length, totalKok, paidIn, totalDebt, expenseIn, kas, players]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <PeriodFilter value={period} periods={periods} onChange={setPeriod} />
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Bagikan statistik"
          className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink-soft shadow-card transition hover:border-court/30 hover:text-court active:scale-95"
        >
          <KIcon name="share" className="size-3.5" />
          Bagikan
        </button>
      </div>

      <ShareChoiceDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Bagikan statistik"
        description={`Periode: ${periodName}`}
        text={sharePayload.text}
        imageBlocks={sharePayload.blocks}
        imageName={`statistik-${period === "all" ? "semua" : period}.png`}
      />

      <div className="grid grid-cols-2 gap-3">
        {kas && (
          <>
            <StatCard
              icon="cash"
              iconClass={kasNet >= 0 ? "text-paid" : "text-danger"}
              label="Total kas"
              value={fmt(kasNet)}
              valueClass={kasNet >= 0 ? "text-paid" : "text-danger"}
              sub={period === "all" ? "saldo bersih" : `bersih · ${periodName}`}
            />
            <StatCard
              icon="cash"
              iconClass="text-paid"
              label="Masuk"
              value={fmt(paidIn)}
              valueClass="text-paid"
              sub="pembayaran lunas"
            />
            <StatCard
              icon="cash"
              iconClass="text-danger"
              label="Beli / keluar"
              value={fmt(expenseIn)}
              valueClass="text-danger"
              sub="beli stok kok"
            />
          </>
        )}
        <StatCard
          icon="cash"
          iconClass="text-owe"
          label="Belum bayar"
          value={fmt(totalDebt)}
          valueClass={totalDebt ? "text-owe" : "text-paid"}
          sub={debtPeople ? `${debtPeople} orang` : "Semua lunas"}
        />
        <StatCard
          icon="racket"
          iconClass="text-court"
          label="Total main"
          value={String(scoped.length)}
          sub={scoped.length ? "game tercatat" : "belum ada"}
        />
        <StatCard
          icon="shuttle"
          iconClass="text-court"
          label="Kok terpakai"
          value={String(totalKok)}
          sub="total kok"
        />
        <StatCard
          icon="package"
          iconClass={stockLeft > 0 ? "text-paid" : "text-danger"}
          label="Stok sisa"
          value={String(stockLeft)}
          valueClass={stockLeft > 0 ? "" : "text-danger"}
          sub={stockLeft > 0 ? `${typesWithStock} jenis tersedia` : "stok habis"}
        />
      </div>

      <div className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name="trophy" className="size-4" />
          </span>
          <h2 className="font-display text-base font-bold tracking-tight">Statistik pemain</h2>
        </div>
        {players.length === 0 ? (
          <EmptyPanel icon="racket" text="Belum ada pemain." />
        ) : (
          <div className="grid gap-2">
            {players.map((s, i) => (
              <div
                key={s.name}
                className="animate-rise flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3"
              >
                <span className="font-display tabular w-4 shrink-0 text-center text-sm font-bold text-ink-faint">
                  {i + 1}
                </span>
                <Avatar name={s.name} photo={photoMap[s.name]} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      <KIcon name="racket" className="size-3" /> {s.main} main
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <KIcon name="shuttle" className="size-3" /> {s.kok} kok
                    </span>
                    <span className="tabular inline-flex items-center gap-1 font-mono">
                      <KIcon name="cash" className="size-3" /> {fmt(s.keluar)}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {s.nunggak > 0 ? (
                    <div className="tabular font-mono text-sm font-bold text-owe">{fmt(s.nunggak)}</div>
                  ) : (
                    <div className="inline-flex items-center gap-1 text-sm font-bold text-paid">
                      <KIcon name="checkCircle" className="size-3.5" /> Lunas
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
