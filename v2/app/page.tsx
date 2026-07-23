import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { HistoryView } from "@/components/kok/history-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function RiwayatPage() {
  const data = await getData();
  const isAdmin = data.me.role === "admin";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : data.me.role === "operator" ? `Operator · ${data.me.name}` : "Kas · Read-only"}
      right={data.me.role ? <SessionBadge role={data.me.role} name={data.me.name} /> : undefined}
    >
      <HistoryView
        games={data.games}
        photoMap={buildPhotoMap(data.players)}
        editable={isAdmin}
        kokTypes={data.kokTypes}
        players={data.players}
        defaultPrice={data.settings.defaultPricePerPerson}
      />
    </AppFrame>
  );
}
