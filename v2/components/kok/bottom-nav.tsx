"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
      label: "Bayar",
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

  if (adminChrome && role === "admin") {
    items.push({
      href: "/admin/lainnya",
      label: "Lainnya",
      icon: "dotsHorizontal",
      match: (p) => p.startsWith("/admin/lainnya"),
    });
  } else if (!adminChrome) {
    // Nav publik: Lainnya → masuk admin / kunci
    items.push({
      href: "/admin",
      label: "Lainnya",
      icon: "dotsHorizontal",
      match: (p) => p.startsWith("/admin"),
    });
  }

  return items;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold transition",
        active ? "text-court" : "text-ink-faint hover:text-court",
      )}
    >
      <KIcon name={item.icon} className="size-5" />
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
  // Lockscreen admin: sembunyikan nav biar mirip v1
  if (!role && pathname.startsWith("/admin")) return null;

  // Halaman publik (`/`) selalu pakai nav publik — meski masih login
  // (tombol "Halaman publik" di Lainnya). Di rute lain, login = chrome admin.
  const onPublicHome = pathname === "/";
  const adminChrome = !!role && !onPublicHome;
  const items = buildItems(adminChrome, role);
  const showFab = adminChrome && !!recordGame;

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
