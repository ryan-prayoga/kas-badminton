"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  getSessionAlive,
  setSessionAlive,
  subscribeSessionAlive,
} from "@/lib/session-alive";
import { Lockscreen } from "@/components/lockscreen";

type Role = "admin" | "operator" | null;

/**
 * Kalau rute /admin* tapi sesi sudah mati (SSE push / logout),
 * langsung render Lockscreen — tanpa nunggu router.refresh() selesai.
 */
export function SessionGuard({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const alive = useSyncExternalStore(subscribeSessionAlive, getSessionAlive, () => true);

  // Server masih bilang login → anggap sesi hidup (pasca login / refresh).
  useEffect(() => {
    if (role) setSessionAlive(true);
  }, [role]);

  const effectiveRole = alive ? role : null;
  const onAdminRoute = pathname.startsWith("/admin");

  if (onAdminRoute && !effectiveRole) {
    return <Lockscreen />;
  }

  return children;
}
