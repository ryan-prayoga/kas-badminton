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
  // (setelah menu Halaman publik) di Bayar/Statistik.
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
          className="inline-flex items-center gap-1 rounded-full bg-court/10 px-2.5 py-1 text-xs font-bold text-court transition hover:bg-court/15"
        >
          <KIcon name="shield" className="size-3.5" />
          {label} · buka
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-court/10 px-2.5 py-1 text-xs font-bold text-court">
          <KIcon name="shield" className="size-3.5" />
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={doLogout}
        disabled={pending}
        aria-label="Keluar"
        className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink-soft shadow-card transition hover:text-danger active:scale-95"
      >
        <KIcon name="logout" className="size-4" />
      </button>
    </div>
  );
}
