"use client";

import { useMemo, useState } from "react";
import type {
  DebtEntry,
  EnrichedGame,
  EnrichedTournament,
  ExpenseRow,
  KokType,
  TournamentPair,
} from "@/lib/domain/types";
import { matchKokPerPerson, matchParticipants, tournamentPodium } from "@/lib/domain/tournament";
import { currentPeriodKey, fmt, fmtDate, periodKey, periodLabel, toLocalIso } from "@/lib/format";
import { APP_URL, type ShareCardBlock, type ShareChip, type ShareMetric } from "@/lib/share";
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
  /** Total kok terpakai (main + partai turnamen yang diikuti). */
  kok: number;
  /** Total uang keluar — kok main + kok partai turnamen + iuran patungan turnamen. */
  keluar: number;
  /** Berapa turnamen yang diikuti di periode ini. */
  turnamen: number;
  /** Riwayat juara turnamen — juara1 = Juara 1, dst. */
  juara1: number;
  juara2: number;
  juara3: number;
}

/** Teks share WhatsApp-friendly (*bold*, rapi, mudah dibaca). */
function buildStatsShareText({
  periodName,
  totalGames,
  totalKok,
  tournamentKok,
  totalTournaments,
  paid,
  unpaid,
  expense,
  showKas,
  players,
  stockLeft,
  debtPeople,
  tourFeeTotal,
  tourFeePaid,
  tourFeeUnpaidCount,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  tournamentKok: number;
  totalTournaments: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
  stockLeft?: number;
  debtPeople?: number;
  tourFeeTotal?: number;
  tourFeePaid?: number;
  tourFeeUnpaidCount?: number;
}): string {
  const net = paid - expense;
  const orangNunggak = debtPeople ?? 0;

  const lines: string[] = [
    "🏸 *Kok Badminton · Statistik*",
    `📅 Periode: ${periodName}`,
    "",
    "*Ringkasan*",
    `🏸 Total main: ${totalGames} game`,
    `🪶 Kok terpakai: ${totalKok}${tournamentKok ? ` (${tournamentKok} dari turnamen)` : ""}`,
    `💚 Masuk (lunas): ${fmt(paid)}`,
    `💸 Belum bayar: ${fmt(unpaid)}${orangNunggak ? ` (${orangNunggak} orang)` : " — semua lunas ✅"}`,
  ];

  if (totalTournaments > 0) {
    lines.push(`🏆 Turnamen: ${totalTournaments}`);
  }

  if (tourFeeTotal) {
    lines.push(
      `🎟️ Iuran turnamen: ${fmt(tourFeePaid ?? 0)} terkumpul${tourFeeUnpaidCount ? ` (${tourFeeUnpaidCount} orang belum bayar)` : " — semua lunas ✅"}`,
    );
  }

  if (showKas) {
    lines.push(`🛒 Beli / keluar: ${fmt(expense)}`);
    lines.push(`🏦 Saldo kas: ${fmt(net)}`);
  }
  if (stockLeft !== undefined) {
    lines.push(`📦 Stok sisa: ${stockLeft} kok`);
  }

  if (players.length) {
    lines.push("", `👤 *Statistik pemain (${players.length})*`);
    // ringkas: max 15 nama, sisanya digabung
    const show = players.slice(0, 15);
    show.forEach((p, i) => {
      const juara = [
        p.juara1 ? `🥇×${p.juara1}` : "",
        p.juara2 ? `🥈×${p.juara2}` : "",
        p.juara3 ? `🥉×${p.juara3}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `${i + 1}. *${p.name}* — ${p.main} main · ${p.kok} kok${p.turnamen ? ` · ${p.turnamen} turnamen` : ""}${juara ? ` · ${juara}` : ""}`,
        `   total keluar ${fmt(p.keluar)}`,
      );
    });
    if (players.length > 15) {
      lines.push(`… +${players.length - 15} pemain lain`);
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
  tournamentKok,
  totalTournaments,
  paid,
  unpaid,
  expense,
  showKas,
  players,
  stockLeft,
  debtPeople,
  typesWithStock,
  photoMap,
  tourFeeTotal,
  tourFeePaid,
  tourFeeUnpaidCount,
}: {
  periodName: string;
  totalGames: number;
  totalKok: number;
  tournamentKok: number;
  totalTournaments: number;
  paid: number;
  unpaid: number;
  expense: number;
  showKas: boolean;
  players: PlayerStat[];
  stockLeft?: number;
  debtPeople?: number;
  typesWithStock?: number;
  photoMap?: PhotoMap;
  tourFeeTotal?: number;
  tourFeePaid?: number;
  tourFeeUnpaidCount?: number;
}): ShareCardBlock[] {
  const net = paid - expense;
  const nunggakCount = debtPeople ?? 0;

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
      sub: tournamentKok ? `${tournamentKok} dari turnamen` : "total kok",
    },
  );
  if (totalTournaments > 0) {
    metricItems.push({
      label: "Turnamen",
      value: String(totalTournaments),
      tone: "court",
      icon: "trophy",
      sub: "bagan tercatat",
    });
  }
  if (tourFeeTotal) {
    metricItems.push({
      label: "Iuran Turnamen",
      value: fmt(tourFeePaid ?? 0),
      tone: tourFeeUnpaidCount ? "owe" : "paid",
      icon: "trophy",
      sub: tourFeeUnpaidCount ? `${tourFeeUnpaidCount} orang belum · dari ${fmt(tourFeeTotal)}` : "Semua lunas",
    });
  }
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
      const juara = [
        p.juara1 ? `🥇×${p.juara1}` : "",
        p.juara2 ? `🥈×${p.juara2}` : "",
        p.juara3 ? `🥉×${p.juara3}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const chips: ShareChip[] = [
        { icon: "racket", text: `${p.main} main` },
        { icon: "shuttle", text: `${p.kok} kok` },
      ];
      if (p.turnamen > 0) chips.push({ icon: "trophy", text: `${p.turnamen} turnamen` });
      if (juara) chips.push({ icon: "trophy", text: juara });
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: p.name,
        photo: photoMap?.[p.name],
        chips,
        right: fmt(p.keluar),
        rightTone: "court",
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
  tournaments = [],
}: {
  games: EnrichedGame[];
  debts: DebtEntry[];
  kokTypes: KokType[];
  photoMap: PhotoMap;
  kas?: { paid: number; expense: number; net: number };
  expenses?: ExpenseRow[];
  tournaments?: EnrichedTournament[];
}) {
  const periods = useMemo(() => {
    const keys = new Set<string>();
    // Bulan berjalan selalu tersedia sebagai opsi, walau belum ada game bulan ini.
    keys.add(currentPeriodKey());
    for (const g of games) {
      const k = periodKey(g.date);
      if (k) keys.add(k);
    }
    for (const t of tournaments) {
      const k = periodKey(t.date);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [games, tournaments]);

  const [period, setPeriod] = useState<string>("all");
  const [shareOpen, setShareOpen] = useState(false);

  const scoped = useMemo(
    () => (period === "all" ? games : games.filter((g) => periodKey(g.date) === period)),
    [games, period],
  );

  const scopedTournaments = useMemo(
    () =>
      period === "all" ? tournaments : tournaments.filter((t) => periodKey(t.date) === period),
    [tournaments, period],
  );

  const gameKok = scoped.reduce((s, g) => s + g.cost.kokCount, 0);
  // Kok turnamen dicatat sama seperti kok game: potong stok, ikut total terpakai.
  const tournamentKok = scopedTournaments.reduce((s, t) => s + t.cost.kokCount, 0);
  const totalKok = gameKok + tournamentKok;
  // Kas cuma game + kok turnamen (kokPaid) — iuran patungan (feePaid) pool terpisah,
  // jangan digabung ke saldo kas. Lihat kartu "Iuran Turnamen" di bawah.
  const paidIn =
    scoped.reduce((s, g) => s + g.summary.paidTotal, 0) +
    scopedTournaments.reduce((s, t) => s + t.cost.kokPaid, 0);

  // Turnamen yang masih berlangsung (belum finished) & punya iuran patungan.
  const activeFeeTournaments = scopedTournaments.filter((t) => !t.finished && t.fee > 0);
  const tourFeeTotal = activeFeeTournaments.reduce((s, t) => s + t.cost.feeTotal, 0);
  const tourFeePaid = activeFeeTournaments.reduce((s, t) => s + t.cost.feePaid, 0);
  const tourFeeUnpaidCount = activeFeeTournaments.reduce((s, t) => s + t.cost.unpaidCount, 0);

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
  // stock dalam satuan kok (pcs) — nilai jual = pricePerPerson x 4 pemain per kok
  const stockValue = kokTypes.reduce(
    (s, t) => s + Math.max(0, Number(t.stock) || 0) * (Number(t.pricePerPerson) || 0) * 4,
    0,
  );

  // "Semua waktu": pakai debtSummary asli (sudah dipotong cicilan/carry), sama seperti Rekap.
  // Difilter per bulan: hitung ulang dari game bulan itu aja (carry lintas bulan diabaikan).
  const debtMap = useMemo(() => {
    if (period === "all") return new Map(debts.map((d) => [d.name, d.total]));
    const map = new Map<string, number>();
    for (const g of scoped) {
      for (const p of g.players) {
        if (p.paid || !p.name) continue;
        map.set(p.name, (map.get(p.name) ?? 0) + g.cost.perPerson);
      }
    }
    for (const t of scopedTournaments) {
      if (t.fee <= 0) continue;
      for (const f of t.fees) {
        if (f.paid || !f.name) continue;
        map.set(f.name, (map.get(f.name) ?? 0) + t.fee);
      }
    }
    return map;
  }, [period, debts, scoped, scopedTournaments]);
  const totalDebt = [...debtMap.values()].reduce((s, v) => s + v, 0);
  const debtPeople = debtMap.size;

  const players = useMemo(() => {
    const map = new Map<string, PlayerStat>();
    const bucket = (name: string) => {
      const s = map.get(name) ?? {
        name,
        main: 0,
        kok: 0,
        keluar: 0,
        turnamen: 0,
        juara1: 0,
        juara2: 0,
        juara3: 0,
      };
      map.set(name, s);
      return s;
    };

    for (const g of scoped) {
      const kokCount = Number(g.cost.kokCount) || 0;
      for (const p of g.players) {
        if (!p.name) continue;
        const s = bucket(p.name);
        s.main += 1;
        // Total kok di game yang diikuti pemain ini (sengaja ≠ total kok unik global).
        s.kok += kokCount;
        s.keluar += g.cost.perPerson;
      }
    }

    for (const t of scopedTournaments) {
      // Iuran patungan: sekali per turnamen yang diikuti, ikut kehitung "keluar".
      for (const f of t.fees) {
        if (!f.name) continue;
        const s = bucket(f.name);
        s.turnamen += 1;
        s.keluar += t.fee;
      }
      // Kok per partai turnamen — cuma ditagih ke 4 pemain partai itu, beda dari iuran.
      for (const m of t.matches) {
        if (m.kokTotal <= 0) continue;
        const perPerson = matchKokPerPerson(m);
        for (const name of matchParticipants(m)) {
          if (!name) continue;
          const s = bucket(name);
          s.kok += m.koks.length;
          s.keluar += perPerson;
        }
      }
      // Riwayat juara — juara 1/2/3 dari turnamen yang sudah selesai.
      const podium = tournamentPodium(t);
      const bump = (pair: TournamentPair | null, key: "juara1" | "juara2" | "juara3") => {
        if (!pair) return;
        for (const name of [pair.a, pair.b]) {
          if (!name) continue;
          bucket(name)[key] += 1;
        }
      };
      bump(podium.champion, "juara1");
      bump(podium.runnerUp, "juara2");
      for (const pair of podium.third) bump(pair, "juara3");
    }

    return [...map.values()].sort(
      (a, b) => b.keluar - a.keluar || b.main - a.main || a.name.localeCompare(b.name, "id"),
    );
  }, [scoped, scopedTournaments]);

  const periodName = period === "all" ? "Semua waktu" : periodLabel(period);

  const sharePayload = useMemo(() => {
    const args = {
      periodName,
      totalGames: scoped.length,
      totalKok,
      tournamentKok,
      totalTournaments: scopedTournaments.length,
      paid: paidIn,
      unpaid: totalDebt,
      expense: expenseIn,
      showKas: Boolean(kas),
      players,
      stockLeft,
      debtPeople,
      tourFeeTotal,
      tourFeePaid,
      tourFeeUnpaidCount,
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
    tournamentKok,
    scopedTournaments.length,
    paidIn,
    totalDebt,
    expenseIn,
    kas,
    players,
    stockLeft,
    debtPeople,
    typesWithStock,
    photoMap,
    tourFeeTotal,
    tourFeePaid,
    tourFeeUnpaidCount,
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
          sub={tournamentKok ? `${gameKok} main · ${tournamentKok} turnamen` : "total kok"}
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
        {scopedTournaments.length > 0 && (
          <StatCard
            icon="trophy"
            iconClass="text-court"
            label="Turnamen"
            value={String(scopedTournaments.length)}
            sub="bagan tercatat"
          />
        )}
        {activeFeeTournaments.length > 0 && (
          <StatCard
            icon="trophy"
            iconClass="text-owe"
            label="Iuran Turnamen"
            value={fmt(tourFeePaid)}
            valueClass="text-owe"
            sub={
              tourFeeUnpaidCount
                ? `${tourFeeUnpaidCount} orang belum · dari ${fmt(tourFeeTotal)}`
                : "Semua lunas"
            }
          />
        )}
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
                    {s.turnamen > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <KIcon name="trophy" className="size-3" /> {s.turnamen} turnamen
                      </span>
                    )}
                  </div>
                  {(s.juara1 > 0 || s.juara2 > 0 || s.juara3 > 0) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-bold">
                      {s.juara1 > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-500">
                          <KIcon name="medal" className="size-3.5" /> Juara 1 ×{s.juara1}
                        </span>
                      )}
                      {s.juara2 > 0 && (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <KIcon name="medal" className="size-3.5" /> Juara 2 ×{s.juara2}
                        </span>
                      )}
                      {s.juara3 > 0 && (
                        <span className="inline-flex items-center gap-1 text-orange-700">
                          <KIcon name="medal" className="size-3.5" /> Juara 3 ×{s.juara3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular font-mono text-sm font-bold text-ink">{fmt(s.keluar)}</div>
                  <div className="text-[10px] text-ink-faint">total keluar</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
