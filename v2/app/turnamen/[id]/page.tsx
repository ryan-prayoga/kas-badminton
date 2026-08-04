import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { TournamentDetailView } from "@/components/kok/tournament-detail-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function TurnamenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getData();
  const tournament = data.tournaments.find((t) => t.id === id);
  if (!tournament) notFound();

  const isAdmin = data.me.role === "admin";
  const canEdit = isAdmin || data.me.role === "operator";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <TournamentDetailView
        tournament={tournament}
        photoMap={buildPhotoMap(data.players)}
        editable={canEdit}
        kokTypes={data.kokTypes}
        defaultPrice={data.settings.defaultPricePerPerson}
      />
    </AppFrame>
  );
}
