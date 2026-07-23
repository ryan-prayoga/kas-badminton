import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDynamicQris } from "@/lib/qris";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON" }, { status: 400 });
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const merchant = settings?.merchant_qris;
  if (!merchant) return NextResponse.json({ error: "QRIS belum diatur admin" }, { status: 400 });

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: "Nominal harus angka bulat > 0" }, { status: 400 });
  }

  try {
    const payload = generateDynamicQris(merchant, amount);
    return NextResponse.json({ payload, amount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid";
    return NextResponse.json({ error: "Gagal buat QRIS: " + msg }, { status: 400 });
  }
}
