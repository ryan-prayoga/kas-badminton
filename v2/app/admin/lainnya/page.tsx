import { redirect } from "next/navigation";
import { getData } from "@/lib/data";
import { listOperators } from "@/lib/repo/operators";
import { AppFrame } from "@/components/kok/app-frame";
import { SessionBadge } from "@/components/session-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KokTypesPanel } from "@/components/admin/kok-types-panel";
import { OperatorsPanel } from "@/components/admin/operators-panel";
import { SettingsPanel } from "@/components/admin/settings-panel";
import { PlayersPanel } from "@/components/admin/players-panel";

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
      <Tabs defaultValue="kok">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="kok">Kok</TabsTrigger>
          <TabsTrigger value="pemain">Pemain</TabsTrigger>
          <TabsTrigger value="delegasi">Delegasi</TabsTrigger>
          <TabsTrigger value="setelan">Setelan</TabsTrigger>
        </TabsList>

        <TabsContent value="kok" className="mt-4">
          <KokTypesPanel kokTypes={data.kokTypes} />
        </TabsContent>
        <TabsContent value="pemain" className="mt-4">
          <PlayersPanel players={data.players} />
        </TabsContent>
        <TabsContent value="delegasi" className="mt-4">
          <OperatorsPanel operators={operators} />
        </TabsContent>
        <TabsContent value="setelan" className="mt-4">
          <SettingsPanel
            defaultPrice={data.settings.defaultPricePerPerson}
            merchantQris={data.settings.merchantQris ?? ""}
          />
        </TabsContent>
      </Tabs>
    </AppFrame>
  );
}
