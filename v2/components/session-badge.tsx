"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/server/actions/auth";
import { KIcon } from "@/components/kok/icons";

export function SessionBadge({ role, name }: { role: "admin" | "operator" | null; name?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!role) return null;

  const doLogout = () =>
    startTransition(async () => {
      await logout();
      router.refresh();
    });

  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-court/10 px-2.5 py-1 text-xs font-bold text-court">
        <KIcon name="shield" className="size-3.5" />
        {role === "admin" ? "Admin" : (name ?? "Operator")}
      </span>
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
