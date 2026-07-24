import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { StatsView } from "@/components/kok/stats-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function StatistikPage() {
  const data = await getData();
  const isAdmin = data.me.role === "admin";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <StatsView
        games={data.games}
        debts={data.debtSummary}
        kokTypes={data.kokTypes}
        photoMap={buildPhotoMap(data.players)}
        kas={isAdmin ? data.kas : undefined}
        expenses={isAdmin ? data.expenses : undefined}
      />
    </AppFrame>
  );
}
