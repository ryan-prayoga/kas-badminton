import { getData } from "@/lib/data";
import { AppFrame } from "@/components/kok/app-frame";
import { HistoryView } from "@/components/kok/history-view";
import { buildPhotoMap } from "@/components/kok/avatar";
import { Lockscreen } from "@/components/lockscreen";
import { SessionBadge } from "@/components/session-badge";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const data = await getData();
  if (data.me.role === null) return <Lockscreen />;

  const isAdmin = data.me.role === "admin";

  return (
    <AppFrame
      eyebrow={isAdmin ? "Kas · Admin" : `Operator · ${data.me.name}`}
      right={<SessionBadge role={data.me.role} name={data.me.name} />}
    >
      <HistoryView
        games={data.games}
        photoMap={buildPhotoMap(data.players)}
        editable
        kokTypes={data.kokTypes}
        players={data.players}
        defaultPrice={data.settings.defaultPricePerPerson}
      />
    </AppFrame>
  );
}
