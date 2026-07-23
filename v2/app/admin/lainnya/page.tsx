import { redirect } from "next/navigation";
import { getData } from "@/lib/data";
import { listOperators } from "@/lib/repo/operators";
import { AppFrame } from "@/components/kok/app-frame";
import { SessionBadge } from "@/components/session-badge";
import { LainnyaMenu } from "@/components/admin/lainnya-menu";

export const dynamic = "force-dynamic";

export default async function LainnyaPage() {
  const data = await getData();
  if (data.me.role !== "admin") redirect("/admin");
  const operators = await listOperators();

  return (
    <AppFrame
      eyebrow="Kas · Admin"
      right={<SessionBadge role={data.me.role} name={data.me.name} />}
    >
      <div className="flex flex-col gap-3">
        <div className="px-0.5">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">Lainnya</h2>
          <p className="mt-0.5 text-xs text-ink-soft">Kelola stok, pemain, delegasi, dan setelan.</p>
        </div>
        <LainnyaMenu
          kokTypes={data.kokTypes}
          players={data.players}
          operators={operators}
          defaultPrice={data.settings.defaultPricePerPerson}
          merchantQris={data.settings.merchantQris ?? ""}
        />
      </div>
    </AppFrame>
  );
}
