"use client";

import { useMemo, useState } from "react";
import type { DebtEntry, EnrichedGame, ExpenseRow, KokType } from "@/lib/domain/types";
import { currentPeriodKey, fmt, fmtDate, periodKey, periodLabel, toLocalIso } from "@/lib/format";
import { APP_URL, type ShareCardBlock, type ShareMetric } from "@/lib/share";
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

/** Teks share WhatsApp-friendly (*bold*, rapi, mudah dibaca). */
function buildStatsShareText({
  periodName,
  totalGames,
  totalKok,
  paid,
  unpaid,
  expense,
  showKas,
  players,
  stockLeft,
  debtPeople,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
  stockLeft?: number;
  debtPeople?: number;
}): string {
  const net = paid - expense;
  const nunggak = players.filter((p) => p.nunggak > 0);
  const lunas = players.filter((p) => p.nunggak <= 0);
  const orangNunggak = debtPeople ?? nunggak.length;

  const lines: string[] = [
    "🏸 *Kok Badminton · Statistik*",
    `📅 Periode: ${periodName}`,
    "",
    "*Ringkasan*",
    `🏸 Total main: ${totalGames} game`,
    `🪶 Kok terpakai: ${totalKok}`,
    `💚 Masuk (lunas): ${fmt(paid)}`,
    `💸 Belum bayar: ${fmt(unpaid)}${orangNunggak ? ` (${orangNunggak} orang)` : " — semua lunas ✅"}`,
  ];

  if (showKas) {
    lines.push(`🛒 Beli / keluar: ${fmt(expense)}`);
    lines.push(`🏦 Saldo kas: ${fmt(net)}`);
  }
  if (stockLeft !== undefined) {
    lines.push(`📦 Stok sisa: ${stockLeft} kok`);
  }

  if (nunggak.length) {
    lines.push("", `💸 *Belum lunas (${nunggak.length})*`);
    nunggak.forEach((p, i) => {
      lines.push(
        `${i + 1}. *${p.name}* — ${fmt(p.nunggak)}`,
        `   ${p.main} main · ${p.kok} kok · total keluar ${fmt(p.keluar)}`,
      );
    });
  }

  if (lunas.length) {
    lines.push("", `✅ *Sudah lunas (${lunas.length})*`);
    // ringkas: max 12 nama, sisanya digabung
    const show = lunas.slice(0, 12);
    show.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name} — ${p.main} main · ${p.kok} kok`);
    });
    if (lunas.length > 12) {
      lines.push(`… +${lunas.length - 12} pemain lain`);
    }
  }

  if (!players.length) {
    lines.push("", "_Belum ada yang main di periode ini._");
  }

  lines.push("", `🔗 Statistik lengkap & tagihanmu: ${APP_URL}`);
  return lines.join("\n");
}

function buildStatsShareCaption({
  periodName,
  totalGames,
  totalKok,
  unpaid,
  debtPeople,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  unpaid: number;
  debtPeople?: number;
}): string {
  const nunggak = unpaid > 0 ? `belum bayar ${fmt(unpaid)}` : "semua sudah lunas ✅";
  const orang = unpaid > 0 && debtPeople ? ` (${debtPeople} orang)` : "";
  return [
    `🏸 Statistik Kok Badminton · ${periodName}`,
    `${totalGames} main · ${totalKok} kok · ${nunggak}${orang}`,
    `Cek punyamu di ${APP_URL} 🔗`,
  ].join("\n");
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
  stockLeft,
  debtPeople,
  typesWithStock,
  photoMap,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
  stockLeft?: number;
  debtPeople?: number;
  typesWithStock?: number;
  photoMap?: PhotoMap;
}): ShareCardBlock[] {
  const net = paid - expense;
  const nunggakCount = debtPeople ?? players.filter((p) => p.nunggak > 0).length;

  // Urutan + label + sub persis grid StatCard di web
  const metricItems: ShareMetric[] = [];
  if (showKas) {
    metricItems.push(
      {
        label: "Total kas",
        value: fmt(net),
        tone: net >= 0 ? "paid" : "danger",
        icon: "cash",
        sub: periodName === "Semua waktu" ? "saldo bersih" : `bersih · ${periodName}`,
      },
      { label: "Masuk", value: fmt(paid), tone: "paid", icon: "cash", sub: "pembayaran lunas" },
      {
        label: "Beli / keluar",
        value: fmt(expense),
        tone: "danger",
        icon: "cash",
        sub: "beli stok kok",
      },
    );
  }
  metricItems.push(
    {
      label: "Belum bayar",
      value: fmt(unpaid),
      tone: unpaid > 0 ? "owe" : "paid",
      icon: "cash",
      sub: nunggakCount ? `${nunggakCount} orang` : "Semua lunas",
    },
    {
      label: "Total main",
      value: String(totalGames),
      tone: "court",
      icon: "racket",
      sub: totalGames ? "game tercatat" : "belum ada",
    },
    {
      label: "Kok terpakai",
      value: String(totalKok),
      tone: "court",
      icon: "shuttle",
      sub: "total kok",
    },
  );
  if (stockLeft !== undefined) {
    metricItems.push({
      label: "Stok sisa",
      value: String(stockLeft),
      tone: stockLeft > 0 ? "paid" : "danger",
      icon: "package",
      sub: stockLeft > 0 ? `${typesWithStock ?? 0} jenis tersedia` : "stok habis",
    });
  }

  const blocks: ShareCardBlock[] = [
    {
      kind: "header",
      title: "Statistik",
      subtitle: periodName,
      badge: fmtDate(toLocalIso(new Date())),
    },
    { kind: "metrics", items: metricItems },
  ];

  blocks.push({ kind: "section", title: "Statistik pemain", icon: "trophy" });
  if (players.length === 0) {
    blocks.push({
      kind: "kv",
      label: "Status",
      value: "Belum ada pemain",
      tone: "muted",
      icon: "users",
    });
  } else {
    for (const [i, p] of players.entries()) {
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: p.name,
        photo: photoMap?.[p.name],
        chips: [
          { icon: "racket", text: `${p.main} main` },
          { icon: "shuttle", text: `${p.kok} kok` },
          { icon: "cash", text: fmt(p.keluar) },
        ],
        right: p.nunggak > 0 ? fmt(p.nunggak) : "Lunas",
        rightTone: p.nunggak > 0 ? "owe" : "paid",
        initial: p.name.slice(0, 1),
      });
    }
  }

  blocks.push({ kind: "footer" });
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
  const periods = useMemo(() => {
    const keys = new Set<string>();
    // Bulan berjalan selalu tersedia sebagai opsi, walau belum ada game bulan ini.
    keys.add(currentPeriodKey());
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [games]);

  const [period, setPeriod] = useState(() => {
    const cur = currentPeriodKey();
    return periods.includes(cur) ? cur : "all";
  });
  const [shareOpen, setShareOpen] = useState(false);

  const scoped = useMemo(
    () => (period === "all" ? games : games.filter((g) => periodKey(g.date) === period)),
    [games, period],
  );

  const totalKok = scoped.reduce((s, g) => s + g.cost.kokCount, 0);
  const paidIn = scoped.reduce((s, g) => s + g.summary.paidTotal, 0);

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
  // stock dalam satuan kok (pcs) — nilai jual pakai pricePerPerson per kok
  const stockValue = kokTypes.reduce(
    (s, t) => s + Math.max(0, Number(t.stock) || 0) * (Number(t.pricePerPerson) || 0),
    0,
  );

  // Samakan dengan Rekap: total & jumlah orang belum bayar selalu dari debtSummary
  // (sudah dipotong cicilan), bukan dihitung ulang per periode.
  const totalDebt = debts.reduce((s, d) => s + d.total, 0);
  const debtPeople = debts.length;
  const debtMap = useMemo(() => new Map(debts.map((d) => [d.name, d.total])), [debts]);

  const players = useMemo(() => {
    const map = new Map<string, PlayerStat>();
    for (const g of scoped) {
      const kokCount = Number(g.cost.kokCount) || 0;
      for (const p of g.players) {
        if (!p.name) continue;
        const s = map.get(p.name) ?? { name: p.name, main: 0, kok: 0, keluar: 0, nunggak: 0 };
        s.main += 1;
        // Total kok di game yang diikuti pemain ini (sengaja ≠ total kok unik global).
        s.kok += kokCount;
        s.keluar += g.cost.perPerson;
        map.set(p.name, s);
      }
    }
    for (const s of map.values()) {
      // Sisa tagihan asli (sudah dipotong cicilan), sama seperti Rekap — bukan per periode.
      s.nunggak = debtMap.get(s.name) ?? 0;
    }
    return [...map.values()].sort(
      (a, b) => b.nunggak - a.nunggak || b.main - a.main || a.name.localeCompare(b.name, "id"),
    );
  }, [scoped, debtMap]);

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
      stockLeft,
      debtPeople,
    };
    return {
      text: buildStatsShareText(args),
      blocks: buildStatsShareBlocks({ ...args, typesWithStock, photoMap }),
      caption: buildStatsShareCaption({
        periodName,
        totalGames: scoped.length,
        totalKok,
        unpaid: totalDebt,
        debtPeople,
      }),
    };
  }, [
    periodName,
    scoped.length,
    totalKok,
    paidIn,
    totalDebt,
    expenseIn,
    kas,
    players,
    stockLeft,
    debtPeople,
    typesWithStock,
    photoMap,
  ]);

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
        imageCaption={sharePayload.caption}
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
        {kas &&
          (() => {
            const totalUntung = kas.net + totalDebt + stockValue;
            return (
              <StatCard
                icon="cash"
                iconClass={totalUntung >= 0 ? "text-paid" : "text-danger"}
                label="Total untung selama ini"
                value={fmt(totalUntung)}
                valueClass={totalUntung >= 0 ? "text-paid" : "text-danger"}
                sub={`kas ${fmt(kas.net)} + piutang ${fmt(totalDebt)} + stok ${fmt(stockValue)}`}
              />
            );
          })()}
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
                  <div className="truncate font-semibold text-ink" title={s.name}>
                    {s.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
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
                    <div className="inline-flex items-center gap-1 text-sm font-bold text-owe">
                      <KIcon name="alert" className="size-3.5" />
                      <span className="tabular font-mono">{fmt(s.nunggak)}</span>
                    </div>
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
