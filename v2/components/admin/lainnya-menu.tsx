"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KokType, PlayerRow } from "@/lib/domain/types";
import type { OperatorView } from "@/lib/repo/operators";
import { setNavMode } from "@/lib/nav-mode";
import { logout } from "@/server/actions/auth";
import { KokTypesPanel } from "@/components/admin/kok-types-panel";
import { OperatorsPanel } from "@/components/admin/operators-panel";
import { PlayersPanel } from "@/components/admin/players-panel";
import { SettingsPanel } from "@/components/admin/settings-panel";
import { KIcon, type IconName } from "@/components/kok/icons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type PanelKey = "kok" | "pemain" | "delegasi" | "setelan" | null;

const MENU: {
  key: PanelKey | "public" | "lock";
  label: string;
  icon: IconName;
  adminOnly?: boolean;
  href?: string;
  danger?: boolean;
  desc?: string;
}[] = [
  {
    key: "kok",
    label: "Jenis kok & stok",
    icon: "shuttle",
    adminOnly: true,
    desc: "Katalog + stok. Beli slop mengurangi kas (1 slop = 12 kok).",
  },
  {
    key: "pemain",
    label: "Kelola pemain",
    icon: "users",
    adminOnly: true,
    desc: "Ganti nama otomatis update riwayat & tagihan.",
  },
  {
    key: "delegasi",
    label: "Penanggung jawab sementara",
    icon: "clock",
    adminOnly: true,
    desc: "PIN sementara buat catat main. Gak bisa akses kas & setelan.",
  },
  {
    key: "setelan",
    label: "QRIS",
    icon: "qrcode",
    adminOnly: true,
    desc: "Upload foto QRIS cetak merchant. Payload disimpan — tombol Bayar QRIS muncul di tagihan.",
  },
  { key: "public", label: "Halaman publik", icon: "back", href: "/" },
  { key: "lock", label: "Kunci", icon: "lock", danger: true },
];

export function LainnyaMenu({
  kokTypes,
  players,
  operators,
  merchantQris,
}: {
  kokTypes: KokType[];
  players: PlayerRow[];
  operators: OperatorView[];
  defaultPrice?: number;
  merchantQris: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelKey>(null);
  const [pending, startTransition] = useTransition();

  const active = MENU.find((m) => m.key === panel);

  const onLock = () =>
    startTransition(async () => {
      await logout();
      setNavMode("admin");
      // Langsung ke halaman publik, bukan lockscreen PIN
      router.push("/");
      router.refresh();
    });

  return (
    <>
      <div className="rounded-xl2 border border-line bg-surface p-1.5 shadow-card">
        {MENU.map((item) => {
          const className =
            "flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-[0.95rem] font-medium transition active:scale-[0.99] " +
            (item.danger
              ? "text-danger hover:bg-danger/8"
              : "text-ink hover:bg-surface-2");

          if (item.href) {
            return (
              <Link
                key={item.key}
                href={item.href}
                className={className}
                onClick={() => {
                  // Stay di chrome publik saat pindah nav (Rekap/Statistik/Riwayat)
                  if (item.key === "public") setNavMode("public");
                }}
              >
                <KIcon name={item.icon} className="size-5 shrink-0 text-court" />
                <span className="flex-1 text-left">{item.label}</span>
                <KIcon name="chevronDown" className="size-4 -rotate-90 text-ink-faint" />
              </Link>
            );
          }

          if (item.key === "lock") {
            return (
              <button
                key={item.key}
                type="button"
                onClick={onLock}
                disabled={pending}
                className={className}
              >
                <KIcon name={item.icon} className="size-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          }

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setPanel(item.key as PanelKey)}
              className={className}
            >
              <KIcon name={item.icon} className="size-5 shrink-0 text-court" />
              <span className="flex-1 text-left">{item.label}</span>
              <KIcon name="chevronDown" className="size-4 -rotate-90 text-ink-faint" />
            </button>
          );
        })}
      </div>

      <Sheet open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden rounded-t-[1.75rem] border-line pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {/* Header + tombol X tetap di atas; body yang scroll */}
          <SheetHeader className="shrink-0 pr-12">
            <SheetTitle className="font-display">{active?.label ?? "—"}</SheetTitle>
            {active?.desc ? <SheetDescription>{active.desc}</SheetDescription> : null}
          </SheetHeader>
          {/* Semua panel: body flex; list internal yang scroll biar X + header tetap */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {panel === "kok" && <KokTypesPanel kokTypes={kokTypes} />}
            {panel === "pemain" && <PlayersPanel players={players} />}
            {panel === "delegasi" && <OperatorsPanel operators={operators} players={players} />}
            {panel === "setelan" && <SettingsPanel merchantQris={merchantQris} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
