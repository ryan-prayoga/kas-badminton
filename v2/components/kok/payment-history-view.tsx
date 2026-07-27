// History bayar — riwayat kapan admin/operator nandain lunas (per game / lunasin semua) atau cicil.

import type { PaymentHistoryEntry } from "@/lib/domain/types";
import { fmt, fmtDateFull, fmtPaidAt, relativeDay, toLocalIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";
import { EmptyPanel } from "@/components/kok/empty-panel";
import { KIcon } from "@/components/kok/icons";

interface DayGroup {
  date: string;
  entries: PaymentHistoryEntry[];
}

function groupByDay(entries: PaymentHistoryEntry[]): DayGroup[] {
  const map = new Map<string, PaymentHistoryEntry[]>();
  const order: string[] = [];
  for (const e of entries) {
    const day = toLocalIso(new Date(e.createdAt));
    if (!map.has(day)) {
      map.set(day, []);
      order.push(day);
    }
    map.get(day)!.push(e);
  }
  return order.map((date) => ({ date, entries: map.get(date)! }));
}

function EntryRow({ entry, photoMap }: { entry: PaymentHistoryEntry; photoMap: PhotoMap }) {
  const isLunas = entry.type === "lunas";
  return (
    <div className="flex items-center gap-2.5 bg-surface px-3 py-2.5 odd:bg-surface-2">
      <Avatar name={entry.name} photo={photoMap[entry.name]} size="size-8" tone={isLunas ? "paid" : "owe"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{entry.name}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              isLunas ? "bg-paid/12 text-paid" : "bg-owe/12 text-owe",
            )}
          >
            {isLunas ? "Lunas" : "Cicil"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span>{fmtPaidAt(entry.createdAt)}</span>
          {entry.recordedBy && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">oleh {entry.recordedBy}</span>
            </>
          )}
        </div>
      </div>
      <span
        className={cn(
          "tabular shrink-0 font-mono text-sm font-bold",
          isLunas ? "text-paid" : "text-owe",
        )}
      >
        {fmt(entry.amount)}
      </span>
    </div>
  );
}

export function PaymentHistoryView({
  entries,
  photoMap,
}: {
  entries: PaymentHistoryEntry[];
  photoMap: PhotoMap;
}) {
  const groups = groupByDay(entries);

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-court/10 text-court">
          <KIcon name="history" className="size-4" />
        </span>
        <h2 className="font-display text-base font-bold tracking-tight">History bayar</h2>
      </div>

      {entries.length === 0 ? (
        <EmptyPanel icon="history" text="Belum ada riwayat bayar" />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const rel = relativeDay(g.date);
            return (
              <div key={g.date}>
                <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs font-semibold text-ink-soft">
                  <KIcon name="calendar" className="size-3.5 text-ink-faint" />
                  <span>{fmtDateFull(g.date)}</span>
                  {rel && (
                    <span className="rounded-full bg-court/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-court">
                      {rel}
                    </span>
                  )}
                </div>
                <div className="grid gap-px overflow-hidden rounded-xl border border-line">
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} photoMap={photoMap} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
