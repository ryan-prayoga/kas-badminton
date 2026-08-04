// Teks & kartu gambar buat share satu turnamen. Sengaja lengkap di semua
// kondisi: baru dijadwalkan (belum ada hasil), sedang jalan, atau sudah selesai.

import { matchTitle, pairLabel, scoreLine, tournamentStatus } from "@/lib/domain/tournament";
import type { BracketMatch, EnrichedTournament } from "@/lib/domain/types";
import { fmt, fmtDateRange, fmtDateFull } from "@/lib/format";
import { APP_URL, type ShareCardBlock, type ShareMetric } from "@/lib/share";

type Status = ReturnType<typeof tournamentStatus>;

const STATUS_TEXT: Record<Status, string> = {
  "akan-datang": "Akan datang",
  berjalan: "Sedang berjalan",
  selesai: "Selesai",
};

function formatText(t: EnrichedTournament): string {
  return t.format === "knockout" ? "Sistem gugur" : "Semua lawan semua";
}

function scoreFormatText(t: EnrichedTournament): string {
  return t.scoreFormat === "bo3" ? "Rally 21 · best of 3" : "1 game sampai 30";
}

function whenText(t: EnrichedTournament): string {
  return t.endDate ? fmtDateRange(t.date, t.endDate) : fmtDateFull(t.date);
}

/** Nama sisi partai: pasangannya, "BYE", atau "Menunggu" kalau belum ketahuan. */
function sideName(side: BracketMatch["a"]): string {
  return pairLabel(side.pair) || (side.bye ? "BYE" : "Menunggu");
}

/** Baris hasil satu partai: "Semifinal · A / B 21-18 · 21-15 vs C / D". */
function matchLine(t: EnrichedTournament, m: BracketMatch): string {
  const a = sideName(m.a);
  const b = sideName(m.b);
  const title = matchTitle(t, m);
  if (m.autoWin) {
    const lolos = m.winner === "a" ? a : b;
    return `• ${title}: *${lolos}* lolos otomatis (BYE)`;
  }
  if (!m.score) return `• ${title}: ${a} vs ${b} — belum main`;
  const winA = m.winner === "a";
  return `• ${title}: ${winA ? `*${a}*` : a} vs ${winA ? b : `*${b}*`} — ${scoreLine(m.score)}`;
}

export function tournamentShareText(t: EnrichedTournament, today: string): string {
  const status = tournamentStatus(t, today);
  const lines: string[] = [
    `🏆 *${t.name}*`,
    `📅 ${whenText(t)}`,
    `⚙️ ${formatText(t)} · ${t.size} pasangan · ${scoreFormatText(t)}`,
    `📌 Status: ${STATUS_TEXT[status]}${
      t.totalCount ? ` · ${t.playedCount}/${t.totalCount} partai` : ""
    }`,
  ];
  if (t.notes) lines.push(`📝 ${t.notes}`);

  if (t.champion) lines.push("", `🥇 *Juara: ${pairLabel(t.champion)}*`);

  const filled = t.pairs.filter((p) => pairLabel(p));
  if (filled.length) {
    lines.push("", `👥 *Peserta (${filled.length} pasangan)*`);
    filled.forEach((p, i) => lines.push(`${i + 1}. ${pairLabel(p)}`));
  }

  if (t.roundRobin && t.roundRobin.standings.length) {
    lines.push("", "📊 *Klasemen*");
    t.roundRobin.standings.forEach((row, i) => {
      const diff = row.diff > 0 ? `+${row.diff}` : String(row.diff);
      lines.push(
        `${i + 1}. *${pairLabel(row.pair)}* — ${row.won}M ${row.lost}K · selisih ${diff}`,
      );
    });
  }

  // Partai yang dua sisinya kosong tidak menarik buat dibagikan.
  const shown = t.matches.filter((m) => m.a.pair || m.b.pair || m.autoWin);
  if (shown.length) {
    lines.push("", "🏸 *Hasil partai*");
    shown.forEach((m) => lines.push(matchLine(t, m)));
  }

  lines.push("", "💰 *Patungan*");
  if (t.fee > 0) {
    lines.push(
      `Iuran ${fmt(t.fee)}/orang · terkumpul ${fmt(t.cost.feePaid)} dari ${fmt(t.cost.feeTotal)}`,
    );
    const belum = t.fees.filter((f) => !f.paid);
    if (belum.length) {
      lines.push(`Belum bayar (${belum.length}): ${belum.map((f) => f.name).join(", ")}`);
    } else if (t.fees.length) {
      lines.push("Semua sudah patungan ✅");
    }
  } else {
    lines.push("Tanpa iuran.");
  }

  lines.push(
    "",
    `🪶 Kok terpakai: ${t.cost.kokCount}${t.cost.kokCount ? ` (${fmt(t.cost.kokTotal)})` : ""}`,
    "",
    `🔗 Bagan & hasil lengkap: ${APP_URL}/turnamen/${t.id}`,
  );
  return lines.join("\n");
}

export function tournamentShareCaption(t: EnrichedTournament, today: string): string {
  const status = tournamentStatus(t, today);
  const head = t.champion
    ? `Juara: ${pairLabel(t.champion)} 🥇`
    : `${STATUS_TEXT[status]} · ${t.playedCount}/${t.totalCount} partai`;
  return [
    `🏆 ${t.name} — ${whenText(t)}`,
    head,
    `Lihat lengkapnya di ${APP_URL}/turnamen/${t.id} 🔗`,
  ].join("\n");
}

export function tournamentShareBlocks(
  t: EnrichedTournament,
  today: string,
): ShareCardBlock[] {
  const status = tournamentStatus(t, today);

  const metrics: ShareMetric[] = [
    {
      label: "Sistem",
      value: t.format === "knockout" ? "Gugur" : "Round robin",
      tone: "court",
      icon: t.format === "knockout" ? "trophy" : "chart",
      sub: `${t.size} pasangan`,
    },
    {
      label: "Partai",
      value: `${t.playedCount}/${t.totalCount}`,
      tone: "court",
      icon: "racket",
      sub: STATUS_TEXT[status],
    },
    {
      label: "Kok terpakai",
      value: String(t.cost.kokCount),
      tone: "court",
      icon: "shuttle",
      sub: t.cost.kokCount ? fmt(t.cost.kokTotal) : "belum ada",
    },
  ];
  if (t.fee > 0) {
    metrics.push({
      label: "Patungan",
      value: `${t.cost.paidCount}/${t.cost.participants}`,
      tone: t.cost.unpaidCount ? "owe" : "paid",
      icon: "wallet",
      sub: `${fmt(t.fee)}/orang`,
    });
  }

  const blocks: ShareCardBlock[] = [
    {
      kind: "header",
      title: t.name,
      subtitle: whenText(t),
      badge: STATUS_TEXT[status],
    },
    { kind: "metrics", items: metrics },
  ];

  if (t.champion) {
    blocks.push({
      kind: "highlight",
      label: "Juara",
      value: pairLabel(t.champion),
      tone: "paid",
      icon: "trophy",
      hint: t.notes || undefined,
    });
  }

  if (t.roundRobin && t.roundRobin.standings.length) {
    blocks.push({ kind: "section", title: "Klasemen", icon: "chart" });
    t.roundRobin.standings.forEach((row, i) => {
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: pairLabel(row.pair),
        chips: [
          { icon: "racket", text: `${row.played} main` },
          { icon: "trophy", text: `${row.won}M ${row.lost}K` },
        ],
        right: row.diff > 0 ? `+${row.diff}` : String(row.diff),
        rightTone: row.diff > 0 ? "paid" : row.diff < 0 ? "owe" : "muted",
        initial: pairLabel(row.pair).slice(0, 1),
      });
    });
  }

  const played = t.matches.filter((m) => m.score || m.autoWin);
  if (played.length) {
    blocks.push({ kind: "section", title: "Hasil partai", icon: "racket" });
    played.forEach((m, i) => {
      const a = sideName(m.a);
      const b = sideName(m.b);
      const winner = m.winner === "a" ? a : m.winner === "b" ? b : "—";
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: winner,
        detail: matchTitle(t, m),
        chips: [{ icon: "racket", text: `lawan ${m.winner === "a" ? b : a}` }],
        right: m.autoWin ? "BYE" : scoreLine(m.score),
        rightTone: "paid",
        initial: winner.slice(0, 1),
      });
    });
  } else {
    blocks.push({ kind: "section", title: "Peserta", icon: "users" });
    const filled = t.pairs.filter((p) => pairLabel(p));
    if (filled.length === 0) {
      blocks.push({ kind: "kv", label: "Status", value: "Belum ada pasangan", tone: "muted" });
    } else {
      filled.forEach((p, i) => {
        blocks.push({
          kind: "person",
          rank: i + 1,
          name: pairLabel(p),
          right: "Siap",
          rightTone: "court",
          initial: pairLabel(p).slice(0, 1),
        });
      });
    }
  }

  if (t.fee > 0) {
    blocks.push({ kind: "section", title: "Patungan", icon: "wallet" });
    blocks.push({
      kind: "kv",
      label: "Terkumpul",
      value: `${fmt(t.cost.feePaid)} / ${fmt(t.cost.feeTotal)}`,
      tone: t.cost.unpaidCount ? "owe" : "paid",
      icon: "cash",
    });
    const belum = t.fees.filter((f) => !f.paid);
    if (belum.length) {
      blocks.push({
        kind: "kv",
        label: `Belum bayar (${belum.length})`,
        value: belum.map((f) => f.name).join(", "),
        tone: "owe",
        icon: "users",
      });
    }
  }

  blocks.push({ kind: "footer" });
  return blocks;
}
