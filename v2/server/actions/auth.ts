"use server";

import { headers } from "next/headers";
import { cookies } from "next/headers";
import {
  checkLoginRate,
  clearSessionCookie,
  createSession,
  deleteSession,
  readSession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/auth";
import { authenticate } from "@/lib/repo/operators";
import type { ActionResult } from "@/lib/action-util";

export interface MeView {
  role: "admin" | "operator" | null;
  name?: string;
  expiresAt?: string;
}

export async function getMe(): Promise<MeView> {
  const sess = await readSession();
  if (!sess) return { role: null };
  return {
    role: sess.role,
    name: sess.role === "operator" ? sess.name : undefined,
    expiresAt: sess.role === "operator" ? new Date(sess.expiresAt).toISOString() : undefined,
  };
}

export async function login(pin: string): Promise<ActionResult<MeView>> {
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "local";
  if (!checkLoginRate(ip)) {
    return { ok: false, error: "Terlalu banyak percobaan, coba lagi nanti", status: 429 };
  }

  const sess = await authenticate(String(pin ?? ""));
  if (!sess) return { ok: false, error: "PIN salah", status: 401 };

  const token = createSession(sess);
  const secure = (hdrs.get("x-forwarded-proto") ?? "").includes("https");
  await setSessionCookie(token, sess.expiresAt - Date.now(), secure);

  return {
    ok: true,
    data: {
      role: sess.role,
      name: sess.role === "operator" ? sess.name : undefined,
      expiresAt: sess.role === "operator" ? new Date(sess.expiresAt).toISOString() : undefined,
    },
  };
}

export async function logout(): Promise<ActionResult> {
  const store = await cookies();
  deleteSession(store.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return { ok: true, data: undefined };
}
