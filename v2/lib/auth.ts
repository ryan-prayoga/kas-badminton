// Auth — port PIN/session/rate-limit dari server.js. Session in-memory (proses
// long-lived `next start`, sama seperti desain lama). Guard HMR via globalThis.

import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { DomainError } from "@/lib/domain/errors";

const PIN_LENGTH = 6;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
export const SESSION_COOKIE = "admin_session";
const DATA_DIR = path.join(process.cwd(), "data");
const ADMIN_PIN_FILE = path.join(DATA_DIR, "admin-pin.txt");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export type Role = "admin" | "operator";
export interface Session {
  role: Role;
  expiresAt: number;
  operatorId?: string;
  name?: string;
}

interface AuthState {
  sessions: Map<string, Session>;
  loginAttempts: Map<string, { count: number; resetAt: number }>;
  adminPin?: string;
}

const g = globalThis as unknown as { __kokAuth?: AuthState };
const state: AuthState =
  g.__kokAuth ?? (g.__kokAuth = { sessions: new Map(), loginAttempts: new Map() });

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function generatePin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i++) pin += crypto.randomInt(0, 10);
  return pin;
}

export function getAdminPin(): string {
  if (state.adminPin) return state.adminPin;
  if (process.env.ADMIN_PIN) {
    state.adminPin = String(process.env.ADMIN_PIN).trim();
    return state.adminPin;
  }
  ensureDataDir();
  if (fs.existsSync(ADMIN_PIN_FILE)) {
    state.adminPin = fs.readFileSync(ADMIN_PIN_FILE, "utf8").trim();
    return state.adminPin;
  }
  const generated = generatePin();
  fs.writeFileSync(ADMIN_PIN_FILE, generated);
  console.log(`[admin] PIN admin di-generate: ${generated}`);
  console.log(`[admin] Tersimpan di ${ADMIN_PIN_FILE} — ganti lewat env ADMIN_PIN atau edit lalu restart.`);
  state.adminPin = generated;
  return generated;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return salt + ":" + hash;
}

export function verifyPinHash(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const attempt = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return timingSafeEqualStr(attempt, hash);
}

// --- session store ---

export function createSession(data: Omit<Session, never>): string {
  const token = crypto.randomBytes(32).toString("hex");
  state.sessions.set(token, data);
  return token;
}

export function getSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const sess = state.sessions.get(token);
  if (!sess || sess.expiresAt < Date.now()) {
    if (token) state.sessions.delete(token);
    return null;
  }
  return sess;
}

export function deleteSession(token: string | undefined | null): void {
  if (token) state.sessions.delete(token);
}

export function revokeOperatorSessions(operatorId: string): void {
  for (const [token, sess] of state.sessions) {
    if (sess.operatorId === operatorId) state.sessions.delete(token);
  }
}

export function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const entry = state.loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    state.loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

// --- cookie-bound helpers (Server Actions / Route Handlers) ---

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  return getSession(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(token: string, maxAgeMs: number, secure: boolean) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: Math.max(0, Math.round(maxAgeMs / 1000)),
    path: "/",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requireStaff(): Promise<Session> {
  const sess = await readSession();
  if (!sess) throw new DomainError("Perlu login", 401);
  return sess;
}

export async function requireAdmin(): Promise<Session> {
  const sess = await readSession();
  if (!sess || sess.role !== "admin") throw new DomainError("Perlu login admin", 401);
  return sess;
}

/** recordedBy sesuai role (Admin / nama operator). */
export function recordedByFor(sess: Session): string {
  return sess.role === "admin" ? "Admin" : (sess.name ?? "Operator");
}
