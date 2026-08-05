"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  koksByDate,
  koksByMatch,
  koksTotal,
  matchTitle,
  suggestFee,
  tournamentStatus,
} from "@/lib/domain/tournament";
import {
  tournamentShareBlocks,
  tournamentShareCaption,
  tournamentShareText,
} from "@/lib/tournament-share";
import type { EnrichedTournament, KokType, TournamentKok } from "@/lib/domain/types";
import {
  fmt,
  fmtDate,
  fmtDateFull,
  fmtDateRange,
  fmtPaidAt,
  formatThousands,
  parseLocalDate,
  toLocalIso,
} from "@/lib/format";
import { safeAction } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  addTournamentKoksAction,
  deleteTournamentAction,
  markAllFeesPaidAction,
  removeTournamentKokAction,
  setFeePaidAction,
  updateTournamentAction,
} from "@/server/actions/tournaments";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { BracketView } from "@/components/kok/bracket-view";
import { KIcon, type IconName } from "@/components/kok/icons";
import { MatchDialog } from "@/components/kok/match-dialog";
import { RoundRobinView } from "@/components/kok/round-robin-view";
import { ShareChoiceDialog } from "@/components/kok/share-choice";
import {
  defaultKokDate,
  KokDateField,
  KokLinesEditor,
  kokLinesToKoks,
  newKokLine,
  totalKokFromLines,
  type KokLine,
} from "@/components/kok/kok-lines";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Tampilan status turnamen — dipakai di detail, daftar, dan riwayat. */
export const STATUS_META: Record<
  "akan-datang" | "berjalan" | "selesai",
  { label: string; icon: IconName; className: string }
> = {
  "akan-datang": {
    label: "Akan datang",
    icon: "calendar",
    className: "bg-court/10 text-court",
  },
  berjalan: { label: "Berjalan", icon: "clock", className: "bg-owe/12 text-owe" },
  selesai: { label: "Selesai", icon: "trophy", className: "bg-paid/12 text-paid" },
};

function Section({
  icon,
  title,
  badge,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  badge?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-court/10 text-court">
            <KIcon name={icon} className="size-4" />
          </span>
          <h2 className="font-display truncate text-base font-bold tracking-tight">{title}</h2>
          {badge ? (
            <span className="tabular shrink-0 rounded-full bg-court/10 px-2 py-0.5 text-[11px] font-bold text-court">
              {badge}
            </span>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function KokDialog({
  tournamentId,
  kokTypes,
  defaultPrice,
  startDate,
  endDate,
}: {
  tournamentId: string;
  kokTypes: KokType[];
  defaultPrice: number;
  startDate: string;
  endDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const active = useMemo(() => kokTypes.filter((t) => t.active), [kokTypes]);
  const [lines, setLines] = useState<KokLine[]>(() => [newKokLine(active, defaultPrice)]);
  const [date, setDate] = useState(() => defaultKokDate(startDate, endDate));

  const total = totalKokFromLines(lines);

  const submit = () => {
    const koks = kokLinesToKoks(lines, active, defaultPrice);
    if (koks.length === 0) {
      toast.error("Minimal 1 kok");
      return;
    }
    start(async () => {
      const res = await safeAction(() => addTournamentKoksAction(tournamentId, koks, null, date));
      if (res.ok) {
        toast.success(`${koks.length} kok ditambah`);
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setLines([newKokLine(active, defaultPrice)]);
          setDate(defaultKokDate(startDate, endDate));
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
          >
            <KIcon name="plus" className="size-3.5" /> Tambah kok
          </button>
        }
      />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Tambah kok turnamen</DialogTitle>
          <DialogDescription>Stok kepotong otomatis, sama seperti catat main.</DialogDescription>
        </DialogHeader>
        <KokDateField
          value={date}
          onChange={setDate}
          startDate={startDate}
          endDate={endDate}
          id="kok-umum-date"
        />
        <KokLinesEditor
          lines={lines}
          setLines={setLines}
          kokTypes={kokTypes}
          defaultPrice={defaultPrice}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || total === 0}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
        >
          <KIcon name="plus" className="size-4" /> Tambah {total} kok
        </button>
      </DialogContent>
    </Dialog>
  );
}

function FeeDialog({
  tournamentId,
  fee,
  suggestion,
}: {
  tournamentId: string;
  fee: number;
  suggestion: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(fee || ""));
  const [pending, start] = useTransition();

  const submit = () => {
    start(async () => {
      const res = await safeAction(() =>
        updateTournamentAction(tournamentId, { fee: Number(value) || 0 }),
      );
      if (res.ok) {
        toast.success("Iuran diperbarui");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setValue(String(fee || ""));
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
          >
            <KIcon name="pencil" className="size-3.5" /> Ubah iuran
          </button>
        }
      />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Iuran per orang</DialogTitle>
          <DialogDescription>
            Peserta yang belum bayar muncul di halaman Rekap sebagai tagihan.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-faint">
            Rp
          </span>
          <Input
            inputMode="numeric"
            value={formatThousands(value)}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
            className="h-11 rounded-xl pl-9"
            aria-label="Iuran per orang"
          />
        </div>
        {suggestion > 0 ? (
          <button
            type="button"
            onClick={() => setValue(String(suggestion))}
            className="self-start text-[11px] font-semibold text-court underline underline-offset-2"
          >
            Pakai saran {fmt(suggestion)}/orang (nutup biaya kok)
          </button>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-court text-sm font-bold text-white shadow-court transition active:scale-[0.98] disabled:opacity-60"
        >
          <KIcon name="save" className="size-4" /> Simpan
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function TournamentDetailView({
  tournament,
  photoMap,
  editable,
  kokTypes,
  defaultPrice,
}: {
  tournament: EnrichedTournament;
  photoMap: PhotoMap;
  editable: boolean;
  kokTypes: KokType[];
  defaultPrice: number;
}) {
  const t = tournament;
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [showKoks, setShowKoks] = useState(false);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const suggestion = suggestFee(t.cost.kokTotal, t.cost.participants);
  const today = toLocalIso(new Date());
  const status = tournamentStatus(t, today);

  const share = useMemo(
    () => ({
      text: tournamentShareText(t, today),
      blocks: tournamentShareBlocks(t, today),
      caption: tournamentShareCaption(t, today),
    }),
    [t, today],
  );

  const dayCount = useMemo(() => {
    const start = parseLocalDate(t.date);
    const end = t.endDate ? parseLocalDate(t.endDate) : null;
    if (!start || !end) return 1;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  }, [t.date, t.endDate]);

  const toggleFee = (index: number, paid: boolean) => {
    start(async () => {
      const res = await safeAction(() => setFeePaidAction(t.id, index, paid));
      if (!res.ok) toast.error(res.error);
    });
  };

  const markAll = async () => {
    const ok = await confirm({
      title: "Lunasin semua?",
      message: `Tandai semua peserta sudah patungan (${t.cost.unpaidCount} belum bayar)?`,
      confirmLabel: "Ya, lunasin",
      destructive: false,
    });
    if (!ok) return;
    start(async () => {
      const res = await safeAction(() => markAllFeesPaidAction(t.id, true));
      if (res.ok) toast.success("Semua peserta ditandai lunas");
      else toast.error(res.error);
    });
  };

  const removeKok = (kokId: string) => {
    start(async () => {
      const res = await safeAction(() => removeTournamentKokAction(t.id, kokId));
      if (res.ok) toast.success("Kok dihapus, stok dikembalikan");
      else toast.error(res.error);
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Hapus turnamen?",
      message:
        "Bagan, skor, dan status patungan ikut hilang. Kok turnamen dikembalikan ke stok. Tidak bisa dibatalkan.",
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;
    start(async () => {
      const res = await safeAction(() => deleteTournamentAction(t.id));
      if (res.ok) {
        toast.success("Turnamen dihapus");
        router.push("/turnamen");
      } else {
        toast.error(res.error);
      }
    });
  };

  /**
   * Rincian kok dikelompokkan per partai (tiap partai boleh beda jenis & harga),
   * plus satu baris "kok umum" untuk yang belum diikat ke partai mana pun.
   */
  const kokSections = useMemo(() => {
    const byMatch = koksByMatch(t.koks);
    const sections: {
      key: string;
      title: string;
      count: number;
      total: number;
      types: string[];
      dates: string[];
    }[] = [];

    const describe = (koks: TournamentKok[]) => ({
      count: koks.length,
      total: koksTotal(koks),
      types: [...new Set(koks.map((k) => k.typeName || "Tanpa jenis"))],
      dates: [...new Set(koks.map((k) => k.date))].sort(),
    });

    for (const m of t.matches) {
      const koks = byMatch.get(m.id);
      if (!koks?.length) continue;
      sections.push({ key: m.id, title: matchTitle(t, m), ...describe(koks) });
    }

    const loose = t.cost.looseKoks;
    if (loose.length) {
      sections.push({
        key: "umum",
        title: "Kok umum (belum diikat partai)",
        ...describe(loose),
      });
    }
    return sections;
    // `t` dipakai utuh oleh matchTitle (butuh format + size).
  }, [t]);

  /** Turnamen multi-hari: berapa kok habis tiap harinya. */
  const kokDays = useMemo(
    () => (t.endDate ? koksByDate(t.koks) : []),
    [t.koks, t.endDate],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/turnamen"
              className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint transition hover:text-court"
            >
              <KIcon name="back" className="size-3.5" /> Semua turnamen
            </Link>
            <h1 className="font-display truncate text-xl font-extrabold tracking-tight text-ink">
              {t.name}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <KIcon name="calendar" className="size-3.5" />
                {t.endDate ? `${fmtDateRange(t.date, t.endDate)} · ${dayCount} hari` : fmtDateFull(t.date)}
              </span>
              <span className="inline-flex items-center gap-1">
                <KIcon name="users" className="size-3.5" /> {t.cost.participants} peserta
              </span>
              <span className="inline-flex items-center gap-1">
                <KIcon name="shuttle" className="size-3.5" /> {t.cost.kokCount} kok
              </span>
              <span className="inline-flex items-center gap-1">
                <KIcon name={t.format === "knockout" ? "trophy" : "chart"} className="size-3.5" />
                {t.format === "knockout" ? "Sistem gugur" : "Semua lawan semua"}
              </span>
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
              STATUS_META[status].className,
            )}
          >
            <KIcon name={STATUS_META[status].icon} className="size-3.5" />
            {STATUS_META[status].label}
          </span>
        </div>
        {t.notes ? <p className="mt-2 text-sm text-ink-soft">{t.notes}</p> : null}

        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2/60 text-sm font-semibold text-ink transition active:scale-[0.98]"
        >
          <KIcon name="share" className="size-4" /> Bagikan turnamen
        </button>
        <ShareChoiceDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          title={`Bagikan · ${t.name}`}
          description="Pilih format teks atau gambar"
          text={share.text}
          imageBlocks={share.blocks}
          imageCaption={share.caption}
          imageName={`turnamen-${t.name.toLowerCase().replace(/\s+/g, "-")}.png`}
        />
      </section>

      <Section
        icon={t.format === "knockout" ? "trophy" : "chart"}
        title={t.format === "knockout" ? "Bagan" : "Klasemen & partai"}
        badge={`${t.playedCount}/${t.totalCount}`}
      >
        {t.bracket ? (
          <BracketView
            bracket={t.bracket}
            editable={editable}
            onOpenMatch={(m) => setOpenMatch(m.id)}
          />
        ) : t.roundRobin ? (
          <RoundRobinView
            roundRobin={t.roundRobin}
            editable={editable}
            onOpenMatch={(m) => setOpenMatch(m.id)}
          />
        ) : null}
        <p className="mt-1 text-[11px] text-ink-faint">
          {editable
            ? t.format === "knockout"
              ? "Ketuk partai buat isi skor dan kok yang dipakai di partai itu. Geser ke samping buat babak berikutnya."
              : "Ketuk partai buat isi skor dan kok yang dipakai di partai itu."
            : "Login admin buat isi skor."}
        </p>
      </Section>

      <MatchDialog
        tournament={t}
        matchId={openMatch}
        onClose={() => setOpenMatch(null)}
        editable={editable}
        kokTypes={kokTypes}
        defaultPrice={defaultPrice}
      />

      <Section
        icon="wallet"
        title="Patungan"
        badge={`${t.cost.paidCount}/${t.cost.participants}`}
        action={editable ? <FeeDialog tournamentId={t.id} fee={t.fee} suggestion={suggestion} /> : undefined}
      >
        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            { label: "Per orang", value: fmt(t.fee), tone: "text-ink" },
            { label: "Terkumpul", value: fmt(t.cost.feePaid), tone: "text-paid" },
            { label: "Belum", value: fmt(t.cost.feeUnpaid), tone: "text-owe" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-surface-2/60 p-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                {s.label}
              </p>
              <p className={cn("tabular font-display mt-0.5 text-sm font-extrabold", s.tone)}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {t.fee === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-xs text-ink-faint">
            Iuran masih Rp 0 — turnamen ini tidak menagih siapa pun.
          </p>
        ) : null}

        {t.fees.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface-2 p-3 text-center text-xs text-ink-faint">
            Belum ada peserta di bagan.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {t.fees.map((f, i) => {
              const Tag = editable ? "button" : "div";
              return (
                <li key={f.name}>
                  <Tag
                    {...(editable
                      ? {
                          type: "button" as const,
                          onClick: () => toggleFee(i, !f.paid),
                          disabled: pending,
                        }
                      : {})}
                    className={cn(
                      "flex w-full items-center gap-2.5 bg-surface px-3 py-2.5 text-left",
                      editable && "min-h-11 transition active:scale-[0.99] disabled:opacity-60",
                    )}
                  >
                    <Avatar
                      name={f.name}
                      photo={photoMap[f.name]}
                      size="size-8"
                      tone={f.paid ? "paid" : "owe"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{f.name}</span>
                      {f.paid && f.paidAt ? (
                        <span className="block truncate text-[11px] text-ink-faint">
                          {fmtPaidAt(f.paidAt)}
                          {f.paidBy ? ` · oleh ${f.paidBy}` : ""}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        f.paid ? "bg-paid/12 text-paid" : "bg-owe/12 text-owe",
                      )}
                    >
                      <KIcon name={f.paid ? "checkCircle" : "clock"} className="size-3" />
                      {f.paid ? "Lunas" : "Belum"}
                    </span>
                  </Tag>
                </li>
              );
            })}
          </ul>
        )}

        {editable && t.cost.unpaidCount > 0 && t.fee > 0 ? (
          <button
            type="button"
            onClick={markAll}
            disabled={pending}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-paid/40 bg-paid/10 text-sm font-bold text-paid transition active:scale-[0.98] disabled:opacity-60"
          >
            <KIcon name="checkAll" className="size-4" /> Lunasin semua
          </button>
        ) : null}
      </Section>

      <Section
        icon="shuttle"
        title="Penggunaan kok"
        badge={`${t.cost.kokCount} kok`}
        action={
          editable ? (
            <KokDialog
              tournamentId={t.id}
              kokTypes={kokTypes}
              defaultPrice={defaultPrice}
              startDate={t.date}
              endDate={t.endDate}
            />
          ) : undefined
        }
      >
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/60 p-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              Nilai kok terpakai
            </p>
            <p className="tabular font-display mt-0.5 text-lg font-extrabold text-ink">
              {fmt(t.cost.kokTotal)}
            </p>
          </div>
          {t.koks.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowKoks((v) => !v)}
              aria-expanded={showKoks}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-court transition hover:bg-court/10"
            >
              Rincian
              <KIcon
                name="chevronDown"
                className={cn("size-4 transition-transform", showKoks && "rotate-180")}
              />
            </button>
          ) : null}
        </div>

        {t.koks.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            Belum ada kok dicatat. Kok yang ditambah di sini ikut kehitung di Statistik &quot;Kok
            terpakai&quot; dan memotong stok.
          </p>
        ) : showKoks ? (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {kokSections.map((s) => (
              <li key={s.key} className="flex items-center gap-2 bg-surface px-3 py-2.5">
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-lg",
                    s.key === "umum" ? "bg-surface-2 text-ink-faint" : "bg-court/10 text-court",
                  )}
                >
                  <KIcon name={s.key === "umum" ? "shuttle" : "racket"} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{s.title}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {s.count} kok · {s.types.join(", ")}
                    {t.endDate ? ` · ${s.dates.map((d) => fmtDate(d)).join(", ")}` : ""}
                  </span>
                </span>
                <span className="tabular shrink-0 font-mono text-sm font-bold text-ink-soft">
                  {fmt(s.total)}
                </span>
                {/* Kok partai dihapus dari dialog partainya; di sini cuma kok umum. */}
                {editable && s.key === "umum" ? (
                  <button
                    type="button"
                    onClick={() => removeKok(t.cost.looseKoks[t.cost.looseKoks.length - 1].id)}
                    disabled={pending}
                    aria-label="Hapus satu kok umum"
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    <KIcon name="minus" className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {kokDays.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kokDays.map((d) => (
              <span
                key={d.date}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[11px] font-semibold text-ink-soft"
              >
                <KIcon name="calendar" className="size-3 text-ink-faint" />
                {fmtDate(d.date)} · {d.koks.length} kok
              </span>
            ))}
          </div>
        ) : null}

        {showKoks && t.koks.length > 0 ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            Tambah/hapus kok per partai lewat bagan di atas. Kok umum diatur dari tombol
            &quot;Tambah kok&quot;.
          </p>
        ) : null}
      </Section>

      {editable ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-danger/40 text-sm font-bold text-danger transition active:scale-[0.98] disabled:opacity-60"
        >
          <KIcon name="trash" className="size-4" /> Hapus turnamen
        </button>
      ) : null}
    </div>
  );
}
