"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { DebtEntry, DebtItem } from "@/lib/domain/types";
import { fmt, fmtDate, fmtDateFull, relativeDay, toLocalIso } from "@/lib/format";
import { APP_URL, type ShareCardBlock } from "@/lib/share";
import { cn } from "@/lib/utils";
import { payInstallmentAction, settleAllAction } from "@/server/actions/players";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { ShareChoiceDialog } from "@/components/kok/share-choice";
import { KIcon } from "@/components/kok/icons";
import { QrisDialog } from "@/components/qris-dialog";
import { safeAction } from "@/lib/action-result";

interface DateGroup {
  date: string;
  total: number;
  count: number;
  koks: number;
  /** Berapa item yang datang dari main biasa. */
  games: number;
  /** Nama turnamen yang iurannya belum dibayar di tanggal ini. */
  tournaments: string[];
}

function groupItems(items: DebtItem[]): DateGroup[] {
  const map = new Map<string, DateGroup>();
  const order: string[] = [];
  for (const it of items) {
    let g = map.get(it.date);
    if (!g) {
      g = { date: it.date, total: 0, count: 0, koks: 0, games: 0, tournaments: [] };
      map.set(it.date, g);
      order.push(it.date);
    }
    g.total += Number(it.amount) || 0;
    g.count += 1;
    g.koks += Number(it.kokCount) || 0;
    if (it.kind === "turnamen") g.tournaments.push(it.label || "Turnamen");
    else g.games += 1;
  }
  return order.map((d) => map.get(d)!);
}

/** "3 main", "1 turnamen", atau "2 main · 1 turnamen". */
function itemsLabel(games: number, tournaments: number): string {
  const parts: string[] = [];
  if (games > 0) parts.push(`${games} main`);
  if (tournaments > 0) parts.push(`${tournaments} turnamen`);
  return parts.join(" · ") || "0 main";
}

function countKinds(items: DebtItem[]): { games: number; tournaments: number } {
  let games = 0;
  let tournaments = 0;
  for (const it of items) {
    if (it.kind === "turnamen") tournaments += 1;
    else games += 1;
  }
  return { games, tournaments };
}

function todayLabel(): string {
  return fmtDateFull(toLocalIso(new Date()));
}

function debtShareText(d: DebtEntry): string {
  const grouped = groupItems(d.items);
  const kinds = countKinds(d.items);
  const totalKoks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
  const lines = [
    "🏸 *Kok Badminton · Tagihan Kok*",
    `Halo *${d.name}*, ini rekap kok kamu ya 👇`,
    "",
    `💸 *Sisa tagihan: ${fmt(d.total)}*`,
    `🏸 ${itemsLabel(kinds.games, kinds.tournaments)} · ${totalKoks} kok belum lunas`,
  ];
  if (d.carry > 0) {
    lines.push(`✅ Sudah dicicil ${fmt(d.carry)} dari ${fmt(d.owedGross)}`);
  }
  lines.push("", "📅 *Rincian tagihan*");
  for (const g of grouped) {
    const rel = relativeDay(g.date);
    lines.push(
      `• *${fmtDate(g.date)}*${rel ? ` · ${rel}` : ""}`,
      `  ${itemsLabel(g.games, g.tournaments.length)} · ${g.koks} kok · ${fmt(g.total)}`,
    );
    if (g.tournaments.length) lines.push(`  🏆 ${g.tournaments.join(", ")}`);
  }
  lines.push(
    "",
    "Kalau sudah transfer, kabarin ya biar langsung ditandai lunas 🙏",
    `🔗 Cek tagihanmu kapan aja: ${APP_URL}`,
  );
  return lines.join("\n");
}

function debtShareCaption(d: DebtEntry): string {
  return [
    `🏸 Tagihan kok *${d.name}* — sisa *${fmt(d.total)}*.`,
    `Rincian lengkapnya di ${APP_URL} 🔗`,
  ].join("\n");
}

function debtShareBlocks(d: DebtEntry, photo?: string): ShareCardBlock[] {
  const grouped = groupItems(d.items);
  const kinds = countKinds(d.items);
  const totalKoks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
  const blocks: ShareCardBlock[] = [
    { kind: "header", title: "Tagihan", subtitle: "Belum lunas", badge: todayLabel() },
    {
      kind: "hero",
      name: d.name,
      subtitle: "Tagihan atas nama",
      photo,
      tone: "owe",
      chips: [
        { icon: "racket", text: itemsLabel(kinds.games, kinds.tournaments) },
        { icon: "shuttle", text: `${totalKoks} kok` },
      ],
    },
    {
      kind: "highlight",
      label: "Sisa tagihan",
      value: fmt(d.total),
      tone: "owe",
      icon: "wallet",
      hint:
        d.carry > 0
          ? `Sudah dicicil ${fmt(d.carry)} dari ${fmt(d.owedGross)}`
          : `${itemsLabel(kinds.games, kinds.tournaments)} · ${totalKoks} kok belum lunas`,
    },
  ];
  if (d.carry > 0) {
    blocks.push({
      kind: "kv",
      label: "Sudah dicicil",
      value: `${fmt(d.carry)} / ${fmt(d.owedGross)}`,
      tone: "paid",
      icon: "cash",
    });
  }
  blocks.push({ kind: "section", title: "Rincian tagihan", icon: "calendar" });
  grouped.forEach((g, i) => {
    const rel = relativeDay(g.date);
    blocks.push({
      kind: "person",
      rank: i + 1,
      name: fmtDateFull(g.date),
      chips: [
        { icon: "racket", text: itemsLabel(g.games, g.tournaments.length) },
        { icon: "shuttle", text: `${g.koks} kok` },
      ],
      tag: rel || undefined,
      right: fmt(g.total),
      rightTone: "owe",
      initial: String(Number(g.date.slice(8, 10)) || i + 1),
    });
  });
  blocks.push({ kind: "footer" });
  return blocks;
}

function rekapShareText(debts: DebtEntry[], total: number): string {
  if (!debts.length) {
    return [
      "🏸 *Kok Badminton · Rekap Tagihan*",
      "",
      "🎉 *Semua sudah lunas!* Kas aman, tinggal main.",
      "",
      `🔗 ${APP_URL}`,
    ].join("\n");
  }
  const lines = [
    "🏸 *Kok Badminton · Rekap Tagihan*",
    `📅 Per ${todayLabel()}`,
    "",
    `💸 *Total belum bayar: ${fmt(total)}*`,
    `👥 ${debts.length} orang masih nunggak`,
    "",
    "*Siapa aja nih*",
  ];
  debts.forEach((d, i) => {
    const koks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
    const kinds = countKinds(d.items);
    lines.push(
      `${i + 1}. *${d.name}* — ${fmt(d.total)}`,
      `   ${itemsLabel(kinds.games, kinds.tournaments)} · ${koks} kok`,
    );
  });
  lines.push(
    "",
    "Yuk dilunasin biar kas klub aman 🙏",
    `🔗 Cek rincian punya kamu: ${APP_URL}`,
  );
  return lines.join("\n");
}

function rekapShareCaption(debts: DebtEntry[], total: number): string {
  if (!debts.length) {
    return `🏸 Kok Badminton — semua sudah lunas 🎉\nCek kapan aja di ${APP_URL} 🔗`;
  }
  return [
    `🏸 Rekap belum bayar per ${todayLabel()} — *${fmt(total)}* dari ${debts.length} orang.`,
    `Cek punya kamu di ${APP_URL} 🔗`,
  ].join("\n");
}

function rekapShareBlocks(
  debts: DebtEntry[],
  total: number,
  photoMap: PhotoMap,
): ShareCardBlock[] {
  const blocks: ShareCardBlock[] = [
    { kind: "header", title: "Rekap tagihan", subtitle: "Belum bayar", badge: todayLabel() },
    {
      kind: "highlight",
      label: "Total belum bayar",
      value: fmt(total),
      tone: total > 0 ? "owe" : "paid",
      icon: "wallet",
      hint: debts.length ? `${debts.length} orang masih nunggak` : "Semua sudah lunas 🎉",
    },
    {
      kind: "section",
      title: debts.length ? `Belum bayar (${debts.length})` : "Status",
      icon: debts.length ? "users" : "checkCircle",
    },
  ];
  if (!debts.length) {
    blocks.push({
      kind: "kv",
      label: "Semua pemain",
      value: "Lunas",
      tone: "paid",
      icon: "checkCircle",
    });
  } else {
    debts.forEach((d, i) => {
      const koks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
      const kinds = countKinds(d.items);
      blocks.push({
        kind: "person",
        rank: i + 1,
        name: d.name,
        photo: photoMap[d.name],
        chips: [
          { icon: "racket", text: itemsLabel(kinds.games, kinds.tournaments) },
          { icon: "shuttle", text: `${koks} kok` },
        ],
        right: fmt(d.total),
        rightTone: "owe",
        initial: d.name.slice(0, 1),
      });
    });
  }
  blocks.push({ kind: "footer" });
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
  const panelId = useId();
  const grouped = groupItems(d.items);
  const kinds = countKinds(d.items);
  const totalKoks = d.items.reduce((s, it) => s + (Number(it.kokCount) || 0), 0);
  const photo = photoMap[d.name];
  const shareTextPayload = useMemo(() => debtShareText(d), [d]);
  const shareBlocks = useMemo(() => debtShareBlocks(d, photo), [d, photo]);
  const shareCaption = useMemo(() => debtShareCaption(d), [d]);

  const settle = async () => {
    const ok = await confirm({
      title: "Lunasin semua?",
      message: `Lunasin SEMUA tagihan ${d.name} (${fmt(d.total)})? Semua main${kinds.tournaments ? " & iuran turnamen" : ""}-nya ditandai bayar.`,
      confirmLabel: "Ya, lunasin",
      destructive: false,
    });
    if (!ok) return;
    start(async () => {
      const res = await safeAction(() => settleAllAction(d.name));
      if (res.ok) toast.success(`${d.name} lunas`);
      else toast.error(res.error);
    });
  };

  const pay = () => {
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) return toast.error("Nominal harus lebih dari 0");
    if (amt > d.total) return toast.error(`Nominal melebihi sisa tagihan (${fmt(d.total)})`);
    start(async () => {
      const res = await safeAction(() => payInstallmentAction(d.name, amt));
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
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full select-none items-center justify-between gap-3 p-3.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={d.name} photo={photoMap[d.name]} tone="owe" />
          <div className="min-w-0">
            <div className="font-display truncate font-bold text-ink" title={d.name}>
              {d.name}
            </div>
            <div className="inline-flex items-center gap-2.5 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <KIcon name="racket" className="size-3.5" /> {kinds.games} main
              </span>
              {kinds.tournaments > 0 && (
                <span className="inline-flex items-center gap-1">
                  <KIcon name="trophy" className="size-3.5" /> {kinds.tournaments} turnamen
                </span>
              )}
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

      <div className="acc-panel" data-open={open} id={panelId}>
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
                        <span className="truncate" title={fmtDateFull(g.date)}>
                          {fmtDateFull(g.date)}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-mono text-sm font-bold text-owe">{fmt(g.total)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                      {g.games > 0 && (
                        <span className="flex items-center gap-1">
                          <KIcon name="racket" className="size-3.5" /> {g.games} main
                        </span>
                      )}
                      {g.tournaments.map((t, i) => (
                        <span key={`${t}-${i}`} className="flex min-w-0 items-center gap-1">
                          <KIcon name="trophy" className="size-3.5 shrink-0" />
                          <span className="truncate">{t}</span>
                        </span>
                      ))}
                      {g.koks > 0 && (
                        <span className="flex items-center gap-1">
                          <KIcon name="shuttle" className="size-3" /> {g.koks} kok
                        </span>
                      )}
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
                imageCaption={shareCaption}
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
                        aria-label="Nominal cicilan"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !pending) {
                            e.preventDefault();
                            pay();
                          }
                        }}
                        placeholder={`maks ${d.total}`}
                        className="h-11 w-28 rounded-xl border border-input bg-surface px-3 text-sm text-ink outline-none focus:border-court/50"
                      />
                      <button
                        type="button"
                        onClick={pay}
                        disabled={pending}
                        aria-label="Simpan cicilan"
                        className="grid size-11 place-items-center rounded-xl bg-court text-white shadow-court transition active:scale-95"
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
  const [query, setQuery] = useState("");
  const total = debts.reduce((s, d) => s + d.total, 0);
  const shareTextPayload = useMemo(() => rekapShareText(debts, total), [debts, total]);
  const shareBlocks = useMemo(
    () => rekapShareBlocks(debts, total, photoMap),
    [debts, total, photoMap],
  );
  const shareCaption = useMemo(() => rekapShareCaption(debts, total), [debts, total]);
  const filteredDebts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return debts;
    return debts.filter((d) => d.name.toLowerCase().includes(q));
  }, [debts, query]);

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
        imageCaption={shareCaption}
        imageName="rekap-belum-bayar.png"
      />

      {debts.length === 0 ? (
        <EmptyPanel icon="happy" text="Semua sudah bayar 🎉" />
      ) : (
        <>
          <div className="relative mb-3">
            <KIcon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama..."
              aria-label="Cari nama"
              className="h-11 w-full rounded-xl border border-input bg-surface pl-9 pr-9 text-sm text-ink outline-none focus:border-court/50"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Hapus pencarian"
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition active:scale-95"
              >
                <KIcon name="close" className="size-4" />
              </button>
            )}
          </div>

          {filteredDebts.length === 0 ? (
            <EmptyPanel icon="happy" text={`Nggak ada nama cocok "${query}"`} />
          ) : (
            <div className="flex flex-col gap-3">
              {filteredDebts.map((d) => (
                <DebtCard key={d.name} d={d} photoMap={photoMap} editable={editable} qrisEnabled={qrisEnabled} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
