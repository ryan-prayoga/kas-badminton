// Repo settings — port PUT /api/settings server.js.

import { validateQRIS } from "@prasetya/qris";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";

export interface SettingsView {
  defaultPricePerPerson: number;
  qrisEnabled: boolean;
  merchantQris: string;
}

export async function updateSettings(input: {
  defaultPricePerPerson?: number;
  merchantQris?: string;
}): Promise<SettingsView> {
  const current = await prisma.settings.findUnique({ where: { id: 1 } });
  const data: { default_price_per_person?: number; merchant_qris?: string | null } = {};

  if (input.defaultPricePerPerson !== undefined) {
    const price = Number(input.defaultPricePerPerson);
    if (!Number.isFinite(price) || price < 0) {
      throw new DomainError("defaultPricePerPerson harus angka >= 0");
    }
    data.default_price_per_person = Math.round(price);
  }

  if (input.merchantQris !== undefined) {
    const raw = String(input.merchantQris || "").trim();
    if (raw) {
      const check = validateQRIS(raw);
      if (!check.valid) {
        throw new DomainError("QRIS statis tidak valid: " + (check.errors[0] || "format salah"));
      }
    }
    data.merchant_qris = raw || null;
  }

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      default_price_per_person: data.default_price_per_person ?? 3000,
      merchant_qris: data.merchant_qris ?? current?.merchant_qris ?? null,
    },
    update: data,
  });

  return {
    defaultPricePerPerson: Number(row.default_price_per_person) || 3000,
    qrisEnabled: Boolean(row.merchant_qris),
    merchantQris: row.merchant_qris || "",
  };
}
