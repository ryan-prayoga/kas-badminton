// Repo delegasi/operator + autentikasi PIN — port operators routes + /api/login.

import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { normalizeName } from "@/lib/domain/game";
import { uid } from "@/lib/domain/util";
import {
  getAdminPin,
  generatePin,
  hashPin,
  revokeOperatorSessions,
  SESSION_TTL_MS,
  timingSafeEqualStr,
  verifyPinHash,
  type Session,
} from "@/lib/auth";

export interface OperatorView {
  id: string;
  name: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  active: boolean;
}

export async function listOperators(): Promise<OperatorView[]> {
  const rows = await prisma.operators.findMany({ orderBy: { created_at: "desc" } });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    expiresAt: r.expires_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    active: !r.revoked_at && r.expires_at.getTime() > now,
  }));
}

export async function createOperator(input: {
  name?: string;
  expiresAt?: string;
}): Promise<{ operator: { id: string; name: string; expiresAt: string }; pin: string }> {
  const name = normalizeName(input.name).slice(0, 60);
  if (!name) throw new DomainError("Nama wajib diisi");

  const expiresAt = new Date(input.expiresAt ?? "");
  if (Number.isNaN(expiresAt.getTime())) throw new DomainError("Masa aktif tidak valid");
  if (expiresAt.getTime() <= Date.now()) throw new DomainError("Masa aktif harus di masa depan");
  if (expiresAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    throw new DomainError("Masa aktif maksimal 1 tahun");
  }

  let pin = generatePin();
  while (timingSafeEqualStr(pin, getAdminPin())) pin = generatePin();

  const id = uid();
  await prisma.operators.create({
    data: { id, name, pin_hash: hashPin(pin), expires_at: expiresAt },
  });
  return { operator: { id, name, expiresAt: expiresAt.toISOString() }, pin };
}

export async function revokeOperator(id: string): Promise<void> {
  const res = await prisma.operators.updateMany({
    where: { id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (res.count === 0) throw new DomainError("Delegasi tidak ditemukan / sudah dicabut", 404);
  revokeOperatorSessions(id);
}

/** Cek PIN → data session (belum bikin token). Null kalau salah. */
export async function authenticate(pin: string): Promise<Session | null> {
  if (timingSafeEqualStr(pin, getAdminPin())) {
    return { role: "admin", expiresAt: Date.now() + SESSION_TTL_MS };
  }
  const rows = await prisma.operators.findMany({
    where: { revoked_at: null, expires_at: { gt: new Date() } },
  });
  const match = rows.find((r) => verifyPinHash(pin, r.pin_hash));
  if (!match) return null;
  return {
    role: "operator",
    operatorId: match.id,
    name: match.name,
    expiresAt: Math.min(Date.now() + SESSION_TTL_MS, match.expires_at.getTime()),
  };
}
