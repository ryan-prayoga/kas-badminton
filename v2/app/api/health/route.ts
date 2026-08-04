import { NextResponse } from "next/server";

export const runtime = "nodejs";
// dipakai ConnectionWatchdog sebagai probe koneksi — jangan sampai dijawab
// dari cache mana pun, kalau tidak dia gak bisa bedain hidup dan mati
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
