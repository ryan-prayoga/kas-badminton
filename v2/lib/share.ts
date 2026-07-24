// Share teks / gambar (Web Share API + fallback).

export type ShareCardTone = "default" | "paid" | "owe" | "danger" | "muted" | "court";

export type ShareCardBlock =
  | { kind: "header"; title: string; subtitle?: string }
  | { kind: "kv"; label: string; value: string; tone?: ShareCardTone }
  | { kind: "section"; title: string }
  | {
      kind: "person";
      rank: number;
      name: string;
      detail: string;
      right: string;
      rightTone?: ShareCardTone;
    }
  | { kind: "footer"; text: string };

const TONE: Record<ShareCardTone, string> = {
  default: "#0f1b2d",
  paid: "#0f8a5b",
  owe: "#b96608",
  danger: "#dc2626",
  muted: "#55647b",
  court: "#1560d6",
};

/** Bagikan teks — Web Share, fallback WhatsApp. */
export async function shareText(text: string, title = "Kok Badminton"): Promise<void> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      // user cancel → diam
      if ((e as Error)?.name === "AbortError") return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

/** Bagikan / unduh gambar PNG. */
export async function shareImage(
  blob: Blob,
  filename = "kok-share.png",
  title = "Kok Badminton",
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const canFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canFiles) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "shared";
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return "downloaded";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function measureBlocks(blocks: ShareCardBlock[]): number {
  let h = 48; // top pad after header
  for (const b of blocks) {
    if (b.kind === "header") h += 0; // drawn in header band
    else if (b.kind === "kv") h += 36;
    else if (b.kind === "section") h += 44;
    else if (b.kind === "person") h += 68;
    else if (b.kind === "footer") h += 40;
  }
  return h + 36; // bottom pad
}

/** Render kartu share ke PNG blob (1080px lebar, retina-friendly). */
export async function renderShareCard(blocks: ShareCardBlock[]): Promise<Blob> {
  const W = 1080;
  const padX = 56;
  const header = blocks.find((b) => b.kind === "header") as
    | Extract<ShareCardBlock, { kind: "header" }>
    | undefined;
  const body = blocks.filter((b) => b.kind !== "header");

  const headerH = header?.subtitle ? 168 : 132;
  const bodyH = measureBlocks(body);
  const H = headerH + bodyH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");

  // Background
  ctx.fillStyle = "#eef2f8";
  ctx.fillRect(0, 0, W, H);

  // Card surface
  const cardX = 28;
  const cardY = 28;
  const cardW = W - 56;
  const cardH = H - 56;
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 36);
  ctx.clip();

  // Header band
  const grad = ctx.createLinearGradient(0, cardY, 0, cardY + headerH);
  grad.addColorStop(0, "#1560d6");
  grad.addColorStop(1, "#0e48a8");
  ctx.fillStyle = grad;
  ctx.fillRect(cardX, cardY, cardW, headerH);

  // Subtle circle deco
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.arc(cardX + cardW - 40, cardY + 20, 120, 0, Math.PI * 2);
  ctx.fill();

  if (header) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 28px system-ui, -apple-system, sans-serif";
    ctx.fillText("KOK BADMINTON", padX, cardY + 52);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 52px system-ui, -apple-system, sans-serif";
    ctx.fillText(header.title, padX, cardY + 108);
    if (header.subtitle) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 28px system-ui, -apple-system, sans-serif";
      ctx.fillText(header.subtitle, padX, cardY + 148);
    }
  }

  // Body
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cardX, cardY + headerH, cardW, cardH - headerH);

  let y = cardY + headerH + 48;
  const contentW = cardW - (padX - cardX) * 2;
  const leftX = padX;
  const rightX = cardX + cardW - padX;

  for (const b of body) {
    if (b.kind === "section") {
      y += 8;
      ctx.fillStyle = "#92a0b4";
      ctx.font = "800 22px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.title.toUpperCase(), leftX, y);
      y += 18;
      ctx.strokeStyle = "#e4eaf3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftX, y);
      ctx.lineTo(leftX + contentW, y);
      ctx.stroke();
      y += 28;
      continue;
    }

    if (b.kind === "kv") {
      ctx.fillStyle = "#55647b";
      ctx.font = "600 28px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.label, leftX, y);
      ctx.fillStyle = TONE[b.tone ?? "default"];
      ctx.font = "800 30px ui-monospace, SFMono-Regular, Menlo, monospace";
      const vw = ctx.measureText(b.value).width;
      ctx.fillText(b.value, rightX - vw, y);
      y += 40;
      continue;
    }

    if (b.kind === "person") {
      // row bg
      roundRect(ctx, leftX - 8, y - 28, contentW + 16, 56, 16);
      ctx.fillStyle = "#f4f7fc";
      ctx.fill();

      ctx.fillStyle = "#92a0b4";
      ctx.font = "800 24px system-ui, -apple-system, sans-serif";
      ctx.fillText(String(b.rank), leftX + 8, y + 4);

      ctx.fillStyle = "#0f1b2d";
      ctx.font = "700 28px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.name, leftX + 48, y - 2);

      ctx.fillStyle = "#55647b";
      ctx.font = "500 22px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.detail, leftX + 48, y + 22);

      ctx.fillStyle = TONE[b.rightTone ?? "default"];
      ctx.font = "800 24px ui-monospace, SFMono-Regular, Menlo, monospace";
      const rw = ctx.measureText(b.right).width;
      ctx.fillText(b.right, rightX - rw - 8, y + 6);
      y += 68;
      continue;
    }

    if (b.kind === "footer") {
      y += 8;
      ctx.fillStyle = "#92a0b4";
      ctx.font = "500 22px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.text, leftX, y);
      y += 28;
    }
  }

  ctx.restore();

  // Soft outer shadow via second pass not needed — flat is fine on mobile.

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Gagal encode PNG"))),
      "image/png",
    );
  });
}
