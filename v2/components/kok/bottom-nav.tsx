"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getNavMode, setNavMode, subscribeNavMode } from "@/lib/nav-mode";
import {
  getSessionAlive,
  subscribeSessionAlive,
} from "@/lib/session-alive";
import type { KokType, PlayerRow } from "@/lib/domain/types";
import { KIcon, type IconName } from "@/components/kok/icons";
import { RecordGameSheet } from "@/components/record-game-sheet";

type Role = "admin" | "operator" | null | undefined;

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  match: (p: string) => boolean;
};

function buildItems(adminChrome: boolean, role: Role): NavItem[] {
  const items: NavItem[] = [
    {
      href: adminChrome ? "/admin" : "/",
      label: "Riwayat",
      icon: "history",
      match: (p) => (adminChrome ? p === "/admin" : p === "/"),
    },
    {
      href: "/belum-bayar",
      label: "Rekap",
      icon: "wallet",
      match: (p) => p.startsWith("/belum-bayar"),
    },
    {
      href: "/statistik",
      label: "Statistik",
      icon: "chart",
      match: (p) => p.startsWith("/statistik"),
    },
  ];

  // History bayar: nav sendiri di chrome publik; admin akses lewat menu Lainnya.
  if (!adminChrome) {
    items.push({
      href: "/riwayat-bayar",
      label: "Bayar",
      icon: "cash",
      match: (p) => p.startsWith("/riwayat-bayar"),
    });
  }

  if (adminChrome && role === "admin") {
    items.push({
      href: "/admin/lainnya",
      label: "Lainnya",
      icon: "dotsHorizontal",
      match: (p) => p.startsWith("/admin/lainnya"),
    });
  }

  return items;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] transition",
        active ? "font-extrabold text-court" : "font-semibold text-ink-faint hover:text-court",
      )}
    >
      {/* Chip terisi jadi penanda aktif non-warna (WCAG 1.4.1), bukan sekadar hue */}
      <span className={cn("grid place-items-center rounded-full px-3 py-0.5 transition", active && "bg-court/12")}>
        <KIcon name={item.icon} className="size-5" />
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}

export function BottomNav({
  role,
  recordGame,
}: {
  role?: Role;
  recordGame?: {
    kokTypes: KokType[];
    players: PlayerRow[];
    defaultPrice: number;
  };
}) {
  const pathname = usePathname();
  const storedMode = useSyncExternalStore(subscribeNavMode, getNavMode, () => "admin" as const);
  const sessionAlive = useSyncExternalStore(subscribeSessionAlive, getSessionAlive, () => true);
  // Sesi mati (revoke/expire) → drop role instan tanpa nunggu RSC refresh
  const effectiveRole: Role = sessionAlive ? role : null;

  // Masuk rute admin* → paksa mode admin (persist)
  useEffect(() => {
    if (pathname.startsWith("/admin") && getNavMode() !== "admin") {
      setNavMode("admin");
    }
  }, [pathname]);

  // Lockscreen admin: sembunyikan nav biar mirip v1
  if (!effectiveRole && pathname.startsWith("/admin")) return null;

  // Chrome admin hanya saat:
  // - rute /admin*, atau
  // - masih login + mode admin + BUKAN di home publik `/`
  // Mode `public` (dari menu Lainnya) stay di chrome publik meski pindah
  // Rekap/Statistik — Riwayat tetap `/`, tanpa FAB/Lainnya.
  const adminChrome =
    !!effectiveRole &&
    (pathname.startsWith("/admin") || (storedMode !== "public" && pathname !== "/"));
  const items = buildItems(adminChrome, effectiveRole);
  const showFab = adminChrome && !!recordGame && !!effectiveRole;

  // Sisipkan FAB di tengah: [kiri…] [FAB] […kanan]
  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
    >
      <nav className="pointer-events-auto relative flex w-full max-w-[440px] items-center rounded-[1.75rem] border border-line bg-surface/95 px-1.5 py-1.5 shadow-pop backdrop-blur-xl">
        {left.map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} />
        ))}

        {showFab && recordGame ? (
          <div className="relative z-10 flex shrink-0 items-center justify-center px-1">
            <RecordGameSheet
              kokTypes={recordGame.kokTypes}
              players={recordGame.players}
              defaultPrice={recordGame.defaultPrice}
              trigger={
                <button
                  type="button"
                  aria-label="Catat main baru"
                  className="-my-3 grid size-14 place-items-center rounded-full bg-court text-white shadow-court transition hover:bg-court-deep active:scale-90"
                >
                  <KIcon name="plus" className="size-7" />
                </button>
              }
            />
          </div>
        ) : null}

        {right.map((item) => (
          <NavLink key={item.href + item.label} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}
