"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getNavMode, setNavMode, subscribeNavMode } from "@/lib/nav-mode";
import { logout } from "@/server/actions/auth";
import { KIcon } from "@/components/kok/icons";

export function SessionBadge({ role, name }: { role: "admin" | "operator" | null; name?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const storedMode = useSyncExternalStore(subscribeNavMode, getNavMode, () => "admin" as const);

  useEffect(() => {
    if (pathname.startsWith("/admin") && getNavMode() !== "admin") {
      setNavMode("admin");
    }
  }, [pathname]);

  if (!role) return null;

  // Tombol "Admin · buka" di home publik, atau saat browse mode publik
  // (setelah menu Halaman publik) di Rekap/Statistik.
  const publicBrowse =
    !pathname.startsWith("/admin") &&
    (storedMode === "public" || pathname === "/");
  const label = role === "admin" ? "Admin" : (name ?? "Operator");

  const doLogout = () =>
    startTransition(async () => {
      await logout();
      setNavMode("admin"); // reset preferensi
      // Langsung ke halaman publik, bukan lockscreen PIN
      router.push("/");
      router.refresh();
    });

  return (
    <div className="flex items-center gap-1.5">
      {publicBrowse ? (
        <Link
          href="/admin"
          onClick={() => setNavMode("admin")}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-court/10 px-3.5 text-sm font-bold text-court transition hover:bg-court/15"
        >
          <KIcon name="shield" className="size-4" />
          {label} · buka
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-court/10 px-3.5 text-sm font-bold text-court">
          <KIcon name="shield" className="size-4" />
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={doLogout}
        disabled={pending}
        aria-label="Kunci sesi"
        className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink-soft shadow-card transition hover:border-court/25 hover:bg-court/5 hover:text-court active:scale-95 disabled:opacity-50"
      >
        <KIcon name="lock" className="size-4" />
      </button>
    </div>
  );
}
