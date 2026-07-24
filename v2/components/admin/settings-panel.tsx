"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSettingsAction } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KIcon } from "@/components/kok/icons";

async function decodeQrisFromFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Gagal baca file"));
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Gagal buka gambar"));
    el.src = dataUrl;
  });

  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const code = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
  if (!code?.data) {
    throw new Error("QR gak kebaca. Coba foto lebih jelas / crop pas ke kotak QR.");
  }
  return String(code.data).trim();
}

async function payloadToPreview(payload: string): Promise<string | null> {
  if (!payload) return null;
  try {
    return await QRCode.toDataURL(payload, { width: 240, margin: 1 });
  } catch {
    return null;
  }
}

export function SettingsPanel({ merchantQris }: { merchantQris: string }) {
  const [qris, setQris] = useState(merchantQris);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState(
    merchantQris ? "✓ QRIS aktif" : "QRIS belum diatur",
  );
  const [statusKind, setStatusKind] = useState<"ok" | "error" | "info">(
    merchantQris ? "ok" : "info",
  );
  const [pending, startTransition] = useTransition();
  const [decoding, setDecoding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void payloadToPreview(qris).then((url) => {
      if (!cancelled) setPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qris]);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setDecoding(true);
    setStatus("Membaca QR…");
    setStatusKind("info");
    try {
      const payload = await decodeQrisFromFile(file);
      setQris(payload);
      if (/^0002/.test(payload)) {
        setStatus("✓ QR terbaca. Klik Simpan untuk aktifkan.");
        setStatusKind("ok");
      } else {
        setStatus("QR terbaca tapi bukan format QRIS. Cek lagi.");
        setStatusKind("error");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Gagal baca QR");
      setStatusKind("error");
    } finally {
      setDecoding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = () => {
    setQris("");
    setStatus("QRIS dikosongkan. Klik Simpan buat matikan.");
    setStatusKind("info");
  };

  const save = () =>
    startTransition(async () => {
      const res = await updateSettingsAction({ merchantQris: qris.trim() });
      if (res.ok) {
        toast.success("Pengaturan disimpan");
        const enabled = Boolean(res.data?.qrisEnabled ?? qris.trim());
        setStatus(enabled ? "✓ QRIS aktif" : "QRIS belum diatur");
        setStatusKind(enabled ? "ok" : "info");
      } else toast.error(res.error);
    });

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold">QRIS statis merchant</p>
        <p className="text-xs text-muted-foreground">
          Upload foto QRIS cetak merchant. Payload disimpan, tombol “Bayar QRIS” muncul di tagihan.
        </p>

        <div className="flex flex-col items-center gap-3 rounded-xl2 border border-line bg-surface-2 p-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview QRIS" className="size-44 rounded-lg bg-white p-2" />
          ) : (
            <div className="grid size-44 place-items-center rounded-lg border border-dashed border-line bg-surface text-center text-xs text-ink-faint">
              <div className="flex flex-col items-center gap-1.5 px-3">
                <KIcon name="qrcode" className="size-8 opacity-40" />
                <span>Belum ada QRIS</span>
              </div>
            </div>
          )}

          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={decoding || pending}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-court/40 bg-court/10 px-3 py-2.5 text-sm font-bold text-court transition active:scale-95 disabled:opacity-50"
            >
              {decoding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KIcon name="qrcode" className="size-4" />
              )}
              Upload / foto QRIS
            </button>
            {qris ? (
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink-soft transition hover:text-danger active:scale-95"
              >
                <KIcon name="trash" className="size-4" /> Hapus QRIS
              </button>
            ) : null}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onUpload(e.target.files?.[0])}
          />

          <p
            className={
              "text-xs " +
              (statusKind === "ok"
                ? "text-paid"
                : statusKind === "error"
                  ? "text-danger"
                  : "text-ink-faint")
            }
          >
            {status}
          </p>
        </div>
      </div>

      <Button onClick={save} disabled={pending || decoding} className="w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Simpan pengaturan"}
      </Button>
    </Card>
  );
}
