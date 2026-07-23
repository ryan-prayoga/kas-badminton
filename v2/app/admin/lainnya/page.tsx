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
        <TabsList className="flex h-auto w-full items-center gap-1 rounded-full border border-line bg-surface/85 p-1.5 shadow-card">
          {(
            [
              ["kok", "Kok"],
              ["pemain", "Pemain"],
              ["delegasi", "Delegasi"],
              ["setelan", "Setelan"],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="flex-1 rounded-full border-0 px-2 py-2 text-sm font-semibold text-ink-soft shadow-none transition data-active:bg-court data-active:text-white data-active:shadow-court"
            >
              {label}
            </TabsTrigger>
          ))}
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
