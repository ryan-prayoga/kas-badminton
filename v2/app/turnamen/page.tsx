import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { TournamentListView } from "@/components/kok/tournament-list-view";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function TurnamenPage() {
  const data = await getData();
  const isAdmin = data.me.role === "admin";
  const canEdit = isAdmin || data.me.role === "operator";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <TournamentListView
        tournaments={data.tournaments}
        editable={canEdit}
        kokTypes={data.kokTypes}
        players={data.players}
        defaultPrice={data.settings.defaultPricePerPerson}
      />
    </AppFrame>
  );
}
