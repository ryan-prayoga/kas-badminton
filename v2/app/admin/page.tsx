import Link from "next/link";
import { Settings2, Wallet } from "lucide-react";
import { getData } from "@/lib/data";
import { fmt } from "@/lib/format";
import { AppFrame } from "@/components/kok/app-frame";
import { HistoryView } from "@/components/kok/history-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { Lockscreen } from "@/components/lockscreen";
import { RecordGameSheet } from "@/components/record-game-sheet";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const data = await getData();
  if (data.me.role === null) return <Lockscreen />;

  const isAdmin = data.me.role === "admin";
  const totalUnpaid = data.debtSummary.reduce((s, d) => s + d.total, 0);

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : `Operator · ${data.me.name}`}
      right={<SessionBadge role={data.me.role} name={data.me.name} />}
    >
      <div className="flex flex-col gap-4">
        <RecordGameSheet
          kokTypes={data.kokTypes}
          players={data.players}
          defaultPrice={data.settings.defaultPricePerPerson}
        />

        {isAdmin && data.kas && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Masuk", value: data.kas.paid, cls: "text-brand" },
              { label: "Keluar", value: data.kas.expense, cls: "text-warn" },
              { label: "Kas", value: data.kas.net, cls: "text-ink50" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl2 border border-line bg-surface p-3 shadow-card">
                <p className="text-[11px] uppercase tracking-wide text-soft">{k.label}</p>
                <p className={`tabular mt-0.5 text-sm font-bold ${k.cls}`}>{fmt(k.value)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/belum-bayar"
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium shadow-card transition hover:border-line2"
          >
            <Wallet className="size-4 text-warn" />
            Tagihan
            {totalUnpaid > 0 && (
              <span className="tabular ml-auto text-xs text-soft">{fmt(totalUnpaid)}</span>
            )}
          </Link>
          {isAdmin && (
            <Link
              href="/admin/lainnya"
              className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium shadow-card transition hover:border-line2"
            >
              <Settings2 className="size-4 text-brand" />
              Lainnya
            </Link>
          )}
        </div>

        <HistoryView
          games={data.games}
          photoMap={buildPhotoMap(data.players)}
          editable
          kokTypes={data.kokTypes}
          players={data.players}
          defaultPrice={data.settings.defaultPricePerPerson}
        />
      </div>
    </AppFrame>
  );
}
