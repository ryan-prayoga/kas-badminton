"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { KIcon, type IconName } from "@/components/kok/icons";

type Role = "admin" | "operator" | null | undefined;

function buildItems(role: Role): { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] {
  const loggedIn = !!role;
  const items: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
    {
      href: loggedIn ? "/admin" : "/",
      label: "Riwayat",
      icon: "history",
      match: (p) => (loggedIn ? p === "/admin" : p === "/"),
    },
    { href: "/belum-bayar", label: "Bayar", icon: "wallet", match: (p) => p.startsWith("/belum-bayar") },
    { href: "/statistik", label: "Statistik", icon: "chart", match: (p) => p.startsWith("/statistik") },
  ];
  if (role === "admin") {
    items.push({
      href: "/admin/lainnya",
      label: "Lainnya",
      icon: "dotsHorizontal",
      match: (p) => p.startsWith("/admin/lainnya"),
    });
  }
  return items;
}

export function BottomNav({ role }: { role?: Role }) {
  const pathname = usePathname();
  // Lockscreen admin: sembunyikan nav biar mirip v1
  if (!role && pathname.startsWith("/admin")) return null;

  const items = buildItems(role);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <nav className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-surface/85 p-1.5 shadow-pop backdrop-blur-xl">
        {items.map(({ href, label, icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition sm:px-4",
                active
                  ? "bg-court text-white shadow-court"
                  : "text-ink-soft hover:bg-court/8 hover:text-court",
              )}
            >
              <KIcon name={icon} className="size-[18px]" />
              <span className={cn(active ? "inline" : "hidden sm:inline")}>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
