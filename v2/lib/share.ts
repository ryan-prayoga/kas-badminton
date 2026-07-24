// Share teks / gambar (Web Share API + fallback).
// Kartu PNG mengikuti Court Ledger (warna, radius, hierarki web).

export type ShareCardTone = "default" | "paid" | "owe" | "danger" | "muted" | "court";

export type ShareMetric = {
  label: string;
  value: string;
  tone?: ShareCardTone;
};

export type ShareCardBlock =
  | { kind: "header"; title: string; subtitle?: string }
  /** Grid kartu ringkas (2 kolom) — mirip StatCard di web. */
  | { kind: "metrics"; items: ShareMetric[] }
  /** Banner angka besar (total tagihan, dll). */
  | { kind: "highlight"; label: string; value: string; tone?: ShareCardTone; hint?: string }
  | { kind: "kv"; label: string; value: string; tone?: ShareCardTone }
  | { kind: "section"; title: string }
  | {
      kind: "person";
      rank: number;
      name: string;
      detail: string;
      right: string;
      rightTone?: ShareCardTone;
      /** Inisial avatar; default huruf pertama nama. */
      initial?: string;
    }
  | { kind: "footer"; text: string };

const C = {
  bg: "#e8eef7",
  surface: "#ffffff",
  surface2: "#f4f7fc",
  ink: "#0f1b2d",
  inkSoft: "#55647b",
  inkFaint: "#92a0b4",
  line: "#e4eaf3",
  lineStrong: "#d3dcea",
  court: "#1560d6",
  courtDeep: "#0e48a8",
  courtSoft: "#eaf1fd",
  paid: "#0f8a5b",
  paidSoft: "#e8f7f0",
  owe: "#b96608",
  oweSoft: "#fff4e5",
  danger: "#dc2626",
  dangerSoft: "#fee2e2",
} as const;

const TONE_FG: Record<ShareCardTone, string> = {
  default: C.ink,
  paid: C.paid,
  owe: C.owe,
  danger: C.danger,
  muted: C.inkSoft,
  court: C.court,
};

const TONE_SOFT: Record<ShareCardTone, string> = {
  default: C.surface2,
  paid: C.paidSoft,
  owe: C.oweSoft,
  danger: C.dangerSoft,
  muted: C.surface2,
  court: C.courtSoft,
};

/** Bagikan teks — Web Share, fallback WhatsApp. */
export async function shareText(text: string, title = "Kok Badminton"): Promise<void> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
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

function fillRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  stroke: string,
  lineWidth = 2,
) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawShadowCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  ctx.shadowColor = "rgba(15, 27, 45, 0.14)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  fillRound(ctx, x, y, w, h, r, C.surface);
  ctx.restore();
  strokeRound(ctx, x, y, w, h, r, C.line, 1.5);
}

/** Ikon raket sederhana (siluet) di header. */
function drawRacketMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = Math.max(2.5, s * 0.08);
  ctx.lineCap = "round";
  // head oval
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.18, s * 0.38, s * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // strings
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s * 0.1, -s * 0.52);
    ctx.lineTo(i * s * 0.1, s * 0.12);
    ctx.stroke();
  }
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.18 + i * s * 0.1);
    ctx.lineTo(s * 0.32, -s * 0.18 + i * s * 0.1);
    ctx.stroke();
  }
  // shaft
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(3, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.12);
  ctx.lineTo(0, s * 0.55);
  ctx.stroke();
  // grip
  ctx.lineWidth = Math.max(5, s * 0.14);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.4);
  ctx.lineTo(0, s * 0.62);
  ctx.stroke();
  ctx.restore();
}

function metricsRows(n: number): number {
  return Math.ceil(Math.max(n, 1) / 2);
}

function measureBlocks(blocks: ShareCardBlock[]): number {
  let h = 28; // top pad body
  for (const b of blocks) {
    if (b.kind === "header") h += 0;
    else if (b.kind === "metrics") {
      const rows = metricsRows(b.items.length);
      h += rows * 118 + (rows - 1) * 16 + 20;
    } else if (b.kind === "highlight") h += b.hint ? 128 : 112;
    else if (b.kind === "kv") h += 44;
    else if (b.kind === "section") h += 56;
    else if (b.kind === "person") h += 88;
    else if (b.kind === "footer") h += 52;
  }
  return h + 28; // bottom pad
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function isLunas(right: string): boolean {
  return /^lunas$/i.test(right.trim());
}

/** Render kartu share ke PNG blob (1080px lebar, retina-friendly). */
export async function renderShareCard(blocks: ShareCardBlock[]): Promise<Blob> {
  const W = 1080;
  const outer = 36;
  const padX = 56;
  const header = blocks.find((b) => b.kind === "header") as
    | Extract<ShareCardBlock, { kind: "header" }>
    | undefined;
  const body = blocks.filter((b) => b.kind !== "header");

  const headerH = header?.subtitle ? 200 : 168;
  const bodyH = measureBlocks(body);
  const H = outer * 2 + headerH + bodyH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");

  // Page bg (soft court wash)
  const pageGrad = ctx.createLinearGradient(0, 0, W, H);
  pageGrad.addColorStop(0, "#dfe8f6");
  pageGrad.addColorStop(0.45, C.bg);
  pageGrad.addColorStop(1, "#e4ecf8");
  ctx.fillStyle = pageGrad;
  ctx.fillRect(0, 0, W, H);

  const cardX = outer;
  const cardY = outer;
  const cardW = W - outer * 2;
  const cardH = H - outer * 2;

  drawShadowCard(ctx, cardX, cardY, cardW, cardH, 40);

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.clip();

  // ── Header band ──
  const headGrad = ctx.createLinearGradient(0, cardY, cardW * 0.3, cardY + headerH);
  headGrad.addColorStop(0, "#1a6ef0");
  headGrad.addColorStop(0.55, C.court);
  headGrad.addColorStop(1, C.courtDeep);
  ctx.fillStyle = headGrad;
  ctx.fillRect(cardX, cardY, cardW, headerH);

  // Decorative orbs
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.arc(cardX + cardW - 48, cardY + 28, 140, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cardX + cardW - 180, cardY + headerH - 10, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.arc(cardX + 80, cardY + headerH + 20, 100, 0, Math.PI * 2);
  ctx.fill();

  // Brand mark
  const markX = padX + 28;
  const markY = cardY + 58;
  fillRound(ctx, padX, cardY + 30, 56, 56, 18, "rgba(255,255,255,0.18)");
  drawRacketMark(ctx, markX, markY, 42);

  if (header) {
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("KOK BADMINTON", padX + 72, cardY + 52);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 54px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(truncateText(ctx, header.title, cardW - padX * 2 - 20), padX + 72, cardY + 112);

    if (header.subtitle) {
      // pill subtitle
      const sub = header.subtitle;
      ctx.font = "700 24px system-ui, -apple-system, sans-serif";
      const sw = ctx.measureText(sub).width;
      const pillW = sw + 28;
      const pillH = 36;
      const pillX = padX + 72;
      const pillY = cardY + 132;
      fillRound(ctx, pillX, pillY, pillW, pillH, 18, "rgba(255,255,255,0.16)");
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(sub, pillX + 14, pillY + 25);
    }
  }

  // Body surface
  ctx.fillStyle = C.surface;
  ctx.fillRect(cardX, cardY + headerH, cardW, cardH - headerH);

  // Soft top fade under header
  const fade = ctx.createLinearGradient(0, cardY + headerH, 0, cardY + headerH + 24);
  fade.addColorStop(0, "rgba(15,27,45,0.04)");
  fade.addColorStop(1, "rgba(15,27,45,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(cardX, cardY + headerH, cardW, 24);

  let y = cardY + headerH + 36;
  const contentW = cardW - (padX - cardX) * 2;
  const leftX = padX;
  const rightX = cardX + cardW - padX;

  for (const b of body) {
    if (b.kind === "metrics") {
      const cols = 2;
      const gap = 16;
      const cellW = (contentW - gap) / cols;
      const cellH = 108;
      b.items.forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = leftX + col * (cellW + gap);
        const cy = y + row * (cellH + gap);
        const tone = item.tone ?? "default";

        fillRound(ctx, x, cy, cellW, cellH, 22, C.surface2);
        strokeRound(ctx, x, cy, cellW, cellH, 22, C.line, 1.5);

        // left accent bar
        fillRound(ctx, x, cy + 18, 6, cellH - 36, 3, TONE_FG[tone] === C.ink ? C.court : TONE_FG[tone]);

        ctx.fillStyle = C.inkFaint;
        ctx.font = "800 18px system-ui, -apple-system, sans-serif";
        ctx.fillText(item.label.toUpperCase(), x + 22, cy + 36);

        ctx.fillStyle = TONE_FG[tone];
        ctx.font = "800 34px ui-monospace, SFMono-Regular, Menlo, monospace";
        const val = truncateText(ctx, item.value, cellW - 36);
        ctx.fillText(val, x + 22, cy + 78);
      });
      y += metricsRows(b.items.length) * (cellH + gap) - gap + 20;
      continue;
    }

    if (b.kind === "highlight") {
      const tone = b.tone ?? "owe";
      const hh = b.hint ? 112 : 96;
      fillRound(ctx, leftX, y, contentW, hh, 24, TONE_SOFT[tone]);
      strokeRound(ctx, leftX, y, contentW, hh, 24, TONE_FG[tone] + "33", 2);

      ctx.fillStyle = TONE_FG[tone];
      ctx.font = "800 18px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.label.toUpperCase(), leftX + 28, y + 34);

      ctx.font = "800 44px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(b.value, leftX + 28, y + (b.hint ? 78 : 74));

      if (b.hint) {
        ctx.fillStyle = C.inkSoft;
        ctx.font = "600 20px system-ui, -apple-system, sans-serif";
        ctx.fillText(b.hint, leftX + 28, y + 100);
      }
      y += hh + 20;
      continue;
    }

    if (b.kind === "section") {
      y += 4;
      // accent chip + title
      fillRound(ctx, leftX, y - 4, 10, 10, 3, C.court);
      ctx.fillStyle = C.inkFaint;
      ctx.font = "800 20px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.title.toUpperCase(), leftX + 20, y + 6);
      y += 18;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftX, y);
      ctx.lineTo(leftX + contentW, y);
      ctx.stroke();
      y += 28;
      continue;
    }

    if (b.kind === "kv") {
      ctx.fillStyle = C.inkSoft;
      ctx.font = "600 26px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.label, leftX, y + 4);
      ctx.fillStyle = TONE_FG[b.tone ?? "default"];
      ctx.font = "800 28px ui-monospace, SFMono-Regular, Menlo, monospace";
      const vw = ctx.measureText(b.value).width;
      ctx.fillText(b.value, rightX - vw, y + 4);
      y += 44;
      continue;
    }

    if (b.kind === "person") {
      const rowH = 76;
      const rowY = y;
      fillRound(ctx, leftX, rowY, contentW, rowH, 20, C.surface2);
      strokeRound(ctx, leftX, rowY, contentW, rowH, 20, C.line, 1.5);

      // rank
      ctx.fillStyle = C.inkFaint;
      ctx.font = "800 22px system-ui, -apple-system, sans-serif";
      const rankStr = String(b.rank);
      const rankW = ctx.measureText(rankStr).width;
      ctx.fillText(rankStr, leftX + 18 + (18 - rankW) / 2, rowY + 44);

      // avatar circle
      const avX = leftX + 52;
      const avY = rowY + 14;
      const avS = 48;
      const tone = b.rightTone ?? "court";
      const avBg =
        tone === "owe" ? C.oweSoft : tone === "paid" ? C.paidSoft : C.courtSoft;
      const avFg =
        tone === "owe" ? C.owe : tone === "paid" ? C.paid : C.court;
      ctx.beginPath();
      ctx.arc(avX + avS / 2, avY + avS / 2, avS / 2, 0, Math.PI * 2);
      ctx.fillStyle = avBg;
      ctx.fill();
      ctx.strokeStyle = C.lineStrong;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const initial = (b.initial || b.name || "?").slice(0, 1).toUpperCase();
      ctx.fillStyle = avFg;
      ctx.font = "800 22px system-ui, -apple-system, sans-serif";
      const iw = ctx.measureText(initial).width;
      ctx.fillText(initial, avX + (avS - iw) / 2, avY + 32);

      // name + detail
      const textX = avX + avS + 16;
      const rightReserve = 200;
      const nameMax = contentW - (textX - leftX) - rightReserve;
      ctx.fillStyle = C.ink;
      ctx.font = "700 28px system-ui, -apple-system, sans-serif";
      ctx.fillText(truncateText(ctx, b.name, nameMax), textX, rowY + 34);

      ctx.fillStyle = C.inkSoft;
      ctx.font = "500 20px system-ui, -apple-system, sans-serif";
      ctx.fillText(truncateText(ctx, b.detail, nameMax), textX, rowY + 58);

      // right status
      const right = b.right;
      if (isLunas(right)) {
        ctx.font = "800 20px system-ui, -apple-system, sans-serif";
        const label = "Lunas";
        const tw = ctx.measureText(label).width;
        const bw = tw + 28;
        const bh = 34;
        const bx = rightX - bw - 16;
        const by = rowY + (rowH - bh) / 2;
        fillRound(ctx, bx, by, bw, bh, 17, C.paidSoft);
        ctx.fillStyle = C.paid;
        ctx.fillText(label, bx + 14, by + 23);
      } else {
        ctx.fillStyle = TONE_FG[b.rightTone ?? "default"];
        ctx.font = "800 26px ui-monospace, SFMono-Regular, Menlo, monospace";
        const rw = ctx.measureText(right).width;
        ctx.fillText(right, rightX - rw - 20, rowY + 46);
      }

      y += rowH + 12;
      continue;
    }

    if (b.kind === "footer") {
      y += 8;
      // brand strip
      fillRound(ctx, leftX, y, contentW, 40, 14, C.surface2);
      ctx.fillStyle = C.inkFaint;
      ctx.font = "600 20px system-ui, -apple-system, sans-serif";
      const ft = b.text;
      const fw = ctx.measureText(ft).width;
      ctx.fillText(ft, leftX + (contentW - fw) / 2, y + 26);
      y += 48;
    }
  }

  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Gagal encode PNG"))),
      "image/png",
    );
  });
}
