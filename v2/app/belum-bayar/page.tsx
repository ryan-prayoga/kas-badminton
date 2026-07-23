import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { DebtView } from "@/components/kok/debt-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function BelumBayarPage() {
  const data = await getData();
  const isAdmin = data.me.role === "admin";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <DebtView
        debts={data.debtSummary}
        photoMap={buildPhotoMap(data.players)}
        editable={data.me.role === "admin"}
        qrisEnabled={data.settings.qrisEnabled}
      />
    </AppFrame>
  );
}
