// Share teks / gambar — kartu PNG di-render dari DOM, 1:1 sama UI web (Court Ledger).

import { toBlob } from "html-to-image";

/** Alamat publik app — dipakai di caption teks & footer kartu gambar. */
export const APP_URL = "https://kok.ryanprayoga.dev";
export const APP_HOST = "kok.ryanprayoga.dev";
export const APP_TAGLINE = "dibuat buat patungan yang rapi";

export type ShareCardTone = "default" | "paid" | "owe" | "danger" | "muted" | "court";

export type ShareIconName =
  | "racket"
  | "shuttle"
  | "cash"
  | "calendar"
  | "checkCircle"
  | "trophy"
  | "wallet"
  | "package"
  | "chart"
  | "users";

/** Chip kecil di bawah nama (mirip baris meta di web: ikon + teks). */
export type ShareChip = { icon: ShareIconName; text: string };

export type ShareMetric = {
  label: string;
  value: string;
  tone?: ShareCardTone;
  /** Subteks kecil di bawah value (mirip StatCard web). */
  sub?: string;
  icon?: ShareIconName;
};

export type ShareCardBlock =
  | { kind: "header"; title: string; subtitle?: string; badge?: string }
  | {
      kind: "hero";
      name: string;
      subtitle?: string;
      photo?: string | null;
      tone?: ShareCardTone;
      chips?: ShareChip[];
    }
  | { kind: "metrics"; items: ShareMetric[] }
  | {
      kind: "highlight";
      label: string;
      value: string;
      tone?: ShareCardTone;
      hint?: string;
      icon?: ShareIconName;
    }
  | { kind: "kv"; label: string; value: string; tone?: ShareCardTone; icon?: ShareIconName }
  | { kind: "section"; title: string; icon?: ShareIconName }
  | {
      kind: "person";
      rank: number;
      name: string;
      detail?: string;
      chips?: ShareChip[];
      right: string;
      rightTone?: ShareCardTone;
      initial?: string;
      photo?: string | null;
      /** Badge kecil di kanan nama (mis. "hari ini"). */
      tag?: string;
    }
  | { kind: "footer"; text?: string };

/** Palet Court Ledger — 1:1 globals.css */
const C = {
  bg: "#eef2f8",
  surface: "#ffffff",
  surface2: "#f4f7fc",
  ink: "#0f1b2d",
  inkSoft: "#55647b",
  inkFaint: "#92a0b4",
  line: "#e4eaf3",
  lineStrong: "#d3dcea",
  court: "#1560d6",
  courtDeep: "#0e48a8",
  courtSoft: "rgba(21, 96, 214, 0.10)",
  paid: "#0f8a5b",
  paidSoft: "rgba(15, 138, 91, 0.12)",
  owe: "#b96608",
  oweSoft: "rgba(185, 102, 8, 0.12)",
  danger: "#dc2626",
  dangerSoft: "rgba(220, 38, 38, 0.12)",
} as const;

const TONE: Record<ShareCardTone, string> = {
  default: C.ink,
  paid: C.paid,
  owe: C.owe,
  danger: C.danger,
  muted: C.inkSoft,
  court: C.court,
};

const TONE_SOFT: Record<ShareCardTone, string> = {
  default: C.courtSoft,
  paid: C.paidSoft,
  owe: C.oweSoft,
  danger: C.dangerSoft,
  muted: "rgba(85, 100, 123, 0.10)",
  court: C.courtSoft,
};

const TONE_BORDER: Record<ShareCardTone, string> = {
  default: C.line,
  paid: "rgba(15,138,91,0.25)",
  owe: "rgba(185,102,8,0.25)",
  danger: "rgba(220,38,38,0.25)",
  muted: C.line,
  court: "rgba(21,96,214,0.25)",
};

const FONT_SANS = 'var(--font-hanken), "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif';
const FONT_DISPLAY = 'var(--font-archivo), Archivo, ui-sans-serif, system-ui, sans-serif';
const FONT_MONO = 'var(--font-jbmono), "JetBrains Mono", ui-monospace, monospace';
const SHADOW_CARD = "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px -14px rgba(15,27,45,0.18)";

/** Path ikon persis sama dengan yang dipakai web (mdi + game-icons). */
const ICON_DATA: Record<ShareIconName, { vb: string; d: string }> = {
  racket: {
    vb: "0 0 24 24",
    d: "M18 15a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4m0 2a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2M6.05 14.54s1.41-1.42 1.42-4.24c-.36-2.19.5-4.76 2.47-6.72C12.87.65 17.14.17 19.5 2.5c2.33 2.36 1.85 6.63-1.08 9.56c-1.96 1.97-4.53 2.83-6.72 2.47c-2.82.01-4.24 1.42-4.24 1.42l-4.24 4.24l-1.41-1.41l4.24-4.24M18.07 3.93C16.5 2.37 13.5 2.84 11.35 5c-2.14 2.14-2.62 5.15-1.06 6.71c1.57 1.56 4.57 1.08 6.71-1.06c2.16-2.15 2.63-5.15 1.07-6.72Z",
  },
  shuttle: {
    vb: "0 0 512 512",
    d: "M256 25.577c-29.75 0-50.618 10.68-64.973 28.623c-12.914 16.144-20.364 38.79-21.74 65.377h173.426c-1.376-26.586-8.826-49.233-21.74-65.377C306.618 36.257 285.75 25.577 256 25.577zm-87 112v14h174v-14H169zm12.443 32l-4.802 30H176v3.994l-12.357 77.167c1.428-.63 3.16-1.226 5.207-1.283c.305-.01.616-.005.935.012c.85.045 1.748.188 2.694.46c3.733 1.07 5.666 3.31 7.077 5.24c.48.654.894 1.32 1.287 1.993l3.455-21.583h23.69l-.94 14.123c.77-.11 1.58-.17 2.448-.154c.41.007.832.028 1.266.066c6.942.61 10.032 4.716 13.134 8.764c.19.248.377.51.565.766l1.568-23.565h21.327v16.658c2.24-1.575 4.94-2.658 8.643-2.658c4.105 0 6.98 1.33 9.357 3.188v-17.188h22.065l1.726 21.443c2.796-3.567 5.923-6.866 12.088-7.408c2.057-.18 3.828.007 5.41.44l-1.166-14.475h23.25l3.41 20.04c.103-.15.194-.303.303-.452c1.41-1.928 3.344-4.17 7.078-5.24c.947-.27 1.845-.414 2.695-.46c.32-.016.63-.02.935-.01c2.137.06 3.942.705 5.405 1.364c.392.176.757.372 1.125.566L336 200.966v-1.39h-.236l-5.104-30H312.4l5.104 30h-17.336l-2.414-30h-18.06l2.415 30h-16.753v-30h-18v30h-16.933l1.998-30h-18.04l-2 30H194.87l4.804-30h-18.23zm10.543 48h19.2l-2 30h-22.004l4.804-30zm37.24 0h18.13v30H227.23l1.997-30zm36.13 0h18.203l2.413 30h-20.616v-30zm36.26 0h18.95l5.104 30h-21.64l-2.413-30zm-92.542 81.246c-.26.187-.317.13-.615.403c-2.248 2.058-5.392 5.725-8.773 10.486c-6.76 9.522-14.636 23.43-21.718 39.035c-14.166 31.21-24.75 69.83-20.933 93.586c1.633 10.164 4.142 16.383 9.713 22.98c5.046 5.977 13.334 12.386 25.902 20.348c7.703-3.16 13.956-6.07 19.063-8.903c-6.09-7.457-9.938-16.05-12.442-25.98c-7.73-30.66 1.108-71.263 13.133-105.434a314.3 314.3 0 0 1 8.914-22.56c-1.638-4.26-3.286-8.186-4.902-11.6c-2.498-5.278-4.953-9.437-6.807-11.856c-.245-.322-.31-.274-.536-.504zm93.852 0c-.226.23-.29.182-.537.504c-1.855 2.42-4.31 6.578-6.808 11.856c-1.616 3.414-3.264 7.34-4.902 11.6a314.3 314.3 0 0 1 8.914 22.56c12.025 34.17 20.863 74.775 13.133 105.435c-2.504 9.93-6.35 18.522-12.442 25.98c5.107 2.83 11.36 5.743 19.063 8.903c12.568-7.96 20.856-14.37 25.902-20.347c5.57-6.597 8.08-12.816 9.713-22.98c3.817-23.757-6.767-62.376-20.932-93.586c-7.08-15.605-14.957-29.513-21.717-39.035c-3.38-4.76-6.525-8.428-8.772-10.486c-.297-.274-.353-.216-.614-.403zm-135.95 1.635c-1.903 1.823-4.114 4.144-6.685 7.29c-7.01 8.585-15.662 21.378-23.95 35.925c-16.576 29.093-31.543 65.874-32.223 89.785c-.508 17.885 2.766 27.703 19.418 46.533c10.897-3.552 18.163-7.016 23.65-11.34c-4.07-7.05-6.53-14.81-7.92-23.462c-5.017-31.22 7.342-70.893 22.313-103.88a316.663 316.663 0 0 1 9.96-20.047c-.554-3.766-1.154-7.28-1.798-10.41c-.892-4.343-1.857-7.72-2.765-10.392zm178.05 0c-.91 2.672-1.874 6.05-2.766 10.39c-.644 3.132-1.244 6.646-1.797 10.413a317.503 317.503 0 0 1 9.96 20.048c14.97 32.987 27.33 72.66 22.313 103.88c-1.39 8.653-3.85 16.412-7.922 23.46c5.488 4.326 12.754 7.79 23.65 11.343c16.653-18.83 19.927-28.647 19.42-46.532c-.68-23.91-15.648-60.692-32.224-89.785c-8.288-14.547-16.94-27.34-23.95-35.924c-2.572-3.148-4.783-5.47-6.685-7.292zm-96.97 9.328c-.153.258-.3.483-.454.746c-5.9 10.077-12.528 24.62-18.217 40.785c-11.378 32.33-18.54 71.73-12.658 95.06c2.516 9.983 5.562 15.958 11.69 22.042c5.55 5.51 14.366 11.172 27.583 18.003c13.217-6.83 22.034-12.493 27.584-18.004c6.127-6.085 9.173-12.06 11.69-22.042c5.882-23.332-1.28-62.73-12.66-95.06c-5.688-16.166-12.315-30.71-18.216-40.786c-.154-.263-.3-.488-.455-.746L256 465.108l-7.943-155.322z",
  },
  cash: {
    vb: "0 0 24 24",
    d: "M5 6h18v12H5V6m9 3a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3M9 8a2 2 0 0 1-2 2v4a2 2 0 0 1 2 2h10a2 2 0 0 1 2-2v-4a2 2 0 0 1-2-2H9m-8 2h2v10h16v2H1V10Z",
  },
  calendar: {
    vb: "0 0 24 24",
    d: "M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.11 0 2-.89 2-2V5a2 2 0 0 0-2-2m0 16H5V9h14v10m0-12H5V5h14v2Z",
  },
  checkCircle: {
    vb: "0 0 24 24",
    d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10s10-4.5 10-10S17.5 2 12 2m-2 15l-5-5l1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9Z",
  },
  trophy: {
    vb: "0 0 24 24",
    d: "M18 2c-.9 0-2 1-2 2H8c0-1-1.1-2-2-2H2v9c0 1 1 2 2 2h2.2c.4 2 1.7 3.7 4.8 4v2.08C8 19.54 8 22 8 22h8s0-2.46-3-2.92V17c3.1-.3 4.4-2 4.8-4H20c1 0 2-1 2-2V2h-4M6 11H4V4h2v7m10 .5c0 1.93-.58 3.5-4 3.5c-3.41 0-4-1.57-4-3.5V6h8v5.5m4-.5h-2V4h2v7Z",
  },
  wallet: {
    vb: "0 0 24 24",
    d: "M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2.28A2 2 0 0 0 22 15V9a2 2 0 0 0-1-1.72V5a2 2 0 0 0-2-2H5m0 2h14v2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6v2H5V5m8 4h7v6h-7V9m3 1.5a1.5 1.5 0 0 0-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5a1.5 1.5 0 0 0 1.5-1.5a1.5 1.5 0 0 0-1.5-1.5Z",
  },
  package: {
    vb: "0 0 24 24",
    d: "M2 10.96a.985.985 0 0 1-.37-1.37L3.13 7c.11-.2.28-.34.47-.42l7.83-4.4c.16-.12.36-.18.57-.18c.21 0 .41.06.57.18l7.9 4.44c.19.1.35.26.44.46l1.45 2.52c.28.48.11 1.09-.36 1.36l-1 .58v4.96c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18c-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 0 1 3 16.5v-5.54c-.3.17-.68.18-1 0m10-6.81v6.7l5.96-3.35L12 4.15M5 15.91l6 3.38v-6.71L5 9.21v6.7m14 0v-3.22l-5 2.9c-.33.18-.7.17-1 .01v3.69l6-3.38m-5.15-2.55l6.28-3.63l-.58-1.01l-6.28 3.63l.58 1.01Z",
  },
  chart: {
    vb: "0 0 24 24",
    d: "M9 17H7v-7h2v7m4 0h-2V7h2v10m4 0h-2v-4h2v4m2 2H5V5h14v14.1M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Z",
  },
  users: {
    vb: "0 0 24 24",
    d: "M13.07 10.41a5 5 0 0 0 0-5.82A3.39 3.39 0 0 1 15 4a3.5 3.5 0 0 1 0 7a3.39 3.39 0 0 1-1.93-.59M5.5 7.5A3.5 3.5 0 1 1 9 11a3.5 3.5 0 0 1-3.5-3.5m2 0A1.5 1.5 0 1 0 9 6a1.5 1.5 0 0 0-1.5 1.5M16 17v2H2v-2s0-4 7-4s7 4 7 4m-2 0c-.14-.78-1.33-2-5-2s-4.93 1.31-5 2m11.95-4A5.32 5.32 0 0 1 18 17v2h4v-2s0-3.63-6.06-4Z",
  },
};

function iconSvg(name: ShareIconName, size: number): string {
  const ic = ICON_DATA[name];
  return `<svg width="${size}" height="${size}" viewBox="${ic.vb}" xmlns="http://www.w3.org/2000/svg" style="display:block"><path fill="currentColor" d="${ic.d}"/></svg>`;
}

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

/** Bagikan / unduh gambar PNG. `caption` ikut terkirim di share sheet (kalau didukung). */
export async function shareImage(
  blob: Blob,
  filename = "kok-share.png",
  title = "Kok Badminton",
  caption?: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const payload: ShareData = caption
    ? { files: [file], title, text: caption }
    : { files: [file], title };
  const canFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canFiles) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (e) {
      // beberapa browser nolak `text` bareng `files` — coba lagi tanpa caption
      if ((e as Error)?.name === "AbortError") return "shared";
      if (caption) {
        try {
          await navigator.share({ files: [file], title });
          return "shared";
        } catch (e2) {
          if ((e2 as Error)?.name === "AbortError") return "shared";
        }
      }
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

function isLunas(right: string): boolean {
  return /^lunas$/i.test(right.trim());
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}

/** Ikon inline + teks, seukuran meta row di web. */
function chipRow(chips: ShareChip[], color: string, fontSize = "11px"): HTMLElement {
  const row = el("div", {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    marginTop: "2px",
    fontSize,
    color,
    lineHeight: "1.3",
  });
  for (const c of chips) {
    const chip = el("span", {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      whiteSpace: "nowrap",
    });
    const ic = el("span", { display: "inline-flex", color });
    ic.innerHTML = iconSvg(c.icon, 12);
    chip.append(ic, document.createTextNode(c.text));
    row.appendChild(chip);
  }
  return row;
}

/** Avatar bulat — pakai foto kalau ada, fallback inisial (persis komponen Avatar web). */
function avatarNode(opts: {
  name: string;
  photo?: string | null;
  initial?: string;
  size: number;
  tone: ShareCardTone;
  fontSize?: number;
}): HTMLElement {
  const { name, photo, initial, size, tone } = opts;
  if (photo) {
    const img = el("img", {
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "999px",
      objectFit: "cover",
      flexShrink: "0",
      boxShadow: `0 0 0 1px ${C.lineStrong}`,
      display: "block",
    });
    (img as HTMLImageElement).src = photo;
    (img as HTMLImageElement).alt = "";
    return img;
  }
  const safeTone: ShareCardTone = tone === "default" || tone === "muted" ? "court" : tone;
  const box = el("div", {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "999px",
    background: TONE_SOFT[safeTone],
    color: TONE[safeTone],
    display: "grid",
    placeItems: "center",
    fontFamily: FONT_DISPLAY,
    fontWeight: "700",
    fontSize: `${opts.fontSize ?? Math.round(size * 0.42)}px`,
    flexShrink: "0",
    lineHeight: "1",
  });
  box.textContent = (initial || name || "?").slice(0, 1).toUpperCase();
  return box;
}

function buildShareDom(blocks: ShareCardBlock[]): HTMLElement {
  const header = blocks.find((b) => b.kind === "header") as
    | Extract<ShareCardBlock, { kind: "header" }>
    | undefined;
  const body = blocks.filter((b) => b.kind !== "header");
  const hasFooter = body.some((b) => b.kind === "footer");

  // Root: max-w-[600px] px-4, sama seperti AppFrame.
  // Jangan set position/offset di sini — style root ikut ter-serialize ke
  // foreignObject waktu snapshot, jadi `position:fixed;left:-10000px` bakal
  // ngedorong isinya keluar kanvas (PNG blank). Offset dipasang di wrapper.
  const root = el("div", {
    position: "static",
    width: "600px",
    boxSizing: "border-box",
    padding: "18px 16px 14px",
    fontFamily: FONT_SANS,
    color: C.ink,
    background: `radial-gradient(120% 80% at 50% -20%, rgba(21, 96, 214, 0.08), transparent 55%), ${C.bg}`,
  });
  root.setAttribute("data-share-card", "1");
  root.style.setProperty("-webkit-font-smoothing", "antialiased");

  const stack = el("div", { display: "flex", flexDirection: "column", gap: "16px" });

  // ── App header — persis AppFrame ──
  const appHeader = el("div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "16px",
    borderRadius: "20px",
    border: `1px solid ${C.line}`,
    background: C.surface,
    boxShadow: SHADOW_CARD,
  });

  const headLeft = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: "0",
  });

  const logo = el("div", {
    width: "44px",
    height: "44px",
    borderRadius: "16px",
    background: C.court,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    flexShrink: "0",
    boxShadow: "0 10px 30px -12px rgba(21,96,214,0.35)",
  });
  logo.innerHTML = iconSvg("racket", 24);

  const headText = el("div", { minWidth: "0" });

  const eyebrow = el("div", {
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: C.inkFaint,
    lineHeight: "1.4",
  });
  const eyebrowBits = [header?.title, header?.subtitle].filter(Boolean);
  eyebrow.textContent = (eyebrowBits.join(" · ") || "Kok Badminton").toUpperCase();

  const title = el("div", {
    fontFamily: FONT_DISPLAY,
    fontSize: "20px",
    fontWeight: "800",
    letterSpacing: "-0.02em",
    lineHeight: "1.2",
    color: C.ink,
  });
  title.textContent = "Kok Badminton";

  headText.append(eyebrow, title);
  headLeft.append(logo, headText);
  appHeader.appendChild(headLeft);

  if (header?.badge) {
    const badge = el("div", {
      flexShrink: "0",
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      borderRadius: "12px",
      background: C.courtSoft,
      color: C.courtDeep,
      padding: "7px 11px",
      fontSize: "12px",
      fontWeight: "700",
      lineHeight: "1",
    });
    const bIc = el("span", { display: "inline-flex", color: C.courtDeep });
    bIc.innerHTML = iconSvg("calendar", 14);
    badge.append(bIc, document.createTextNode(header.badge));
    appHeader.appendChild(badge);
  }

  stack.appendChild(appHeader);

  // ── Body blocks ──
  const section: { wrap: HTMLElement | null; list: HTMLElement | null } = {
    wrap: null,
    list: null,
  };

  const closeSection = () => {
    if (section.wrap && section.list) {
      section.wrap.appendChild(section.list);
      stack.appendChild(section.wrap);
    }
    section.wrap = null;
    section.list = null;
  };

  const openSection = (sectionTitle: string, icon: ShareIconName = "trophy"): HTMLElement => {
    closeSection();
    // rounded-xl2 + border-line + bg-surface + p-4 + shadow-card
    const wrap = el("div", {
      borderRadius: "20px",
      border: `1px solid ${C.line}`,
      background: C.surface,
      padding: "16px",
      boxShadow: SHADOW_CARD,
    });

    const head = el("div", {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "12px",
    });

    const iconBox = el("span", {
      width: "28px",
      height: "28px",
      borderRadius: "12px",
      background: C.courtSoft,
      color: C.court,
      display: "grid",
      placeItems: "center",
      flexShrink: "0",
    });
    iconBox.innerHTML = iconSvg(icon, 16);

    const h = el("div", {
      fontFamily: FONT_DISPLAY,
      fontSize: "16px",
      fontWeight: "700",
      letterSpacing: "-0.01em",
      color: C.ink,
    });
    h.textContent = sectionTitle;

    head.append(iconBox, h);
    wrap.appendChild(head);

    const list = el("div", { display: "flex", flexDirection: "column", gap: "8px" });

    section.wrap = wrap;
    section.list = list;
    return list;
  };

  for (const b of body) {
    if (b.kind === "hero") {
      closeSection();
      const tone = b.tone ?? "court";
      const box = el("div", {
        display: "flex",
        alignItems: "center",
        gap: "14px",
        borderRadius: "20px",
        border: `1px solid ${C.line}`,
        background: C.surface,
        padding: "16px",
        boxShadow: SHADOW_CARD,
      });

      box.appendChild(
        avatarNode({ name: b.name, photo: b.photo, size: 64, tone, fontSize: 26 }),
      );

      const mid = el("div", { minWidth: "0", flex: "1" });
      if (b.subtitle) {
        const sub = el("div", {
          fontSize: "10px",
          fontWeight: "700",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.inkFaint,
          lineHeight: "1.4",
        });
        sub.textContent = b.subtitle.toUpperCase();
        mid.appendChild(sub);
      }
      const nm = el("div", {
        fontFamily: FONT_DISPLAY,
        fontSize: "24px",
        fontWeight: "800",
        letterSpacing: "-0.02em",
        lineHeight: "1.2",
        color: C.ink,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      nm.textContent = b.name;
      mid.appendChild(nm);
      if (b.chips?.length) mid.appendChild(chipRow(b.chips, C.inkSoft, "12px"));

      box.appendChild(mid);
      stack.appendChild(box);
      continue;
    }

    if (b.kind === "metrics") {
      closeSection();
      const grid = el("div", {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
      });

      for (const item of b.items) {
        const tone = item.tone ?? "default";
        // rounded-xl2 + p-3.5 + shadow-card
        const card = el("div", {
          borderRadius: "20px",
          border: `1px solid ${C.line}`,
          background: C.surface,
          padding: "14px",
          boxShadow: SHADOW_CARD,
        });

        const lab = el("div", {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
          fontWeight: "700",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.inkFaint,
          lineHeight: "1.2",
        });
        const ic = el("span", { display: "inline-flex", color: TONE[tone], flexShrink: "0" });
        ic.innerHTML = iconSvg(item.icon ?? "cash", 16);
        lab.append(ic, document.createTextNode(item.label));

        const val = el("div", {
          fontFamily: FONT_DISPLAY,
          fontSize: "24px",
          fontWeight: "800",
          letterSpacing: "-0.02em",
          marginTop: "6px",
          lineHeight: "1.15",
          color: TONE[tone],
          fontVariantNumeric: "tabular-nums",
        });
        val.textContent = item.value;

        card.append(lab, val);
        if (item.sub) {
          const sub = el("div", { marginTop: "2px", fontSize: "12px", color: C.inkSoft });
          sub.textContent = item.sub;
          card.appendChild(sub);
        }
        grid.appendChild(card);
      }
      stack.appendChild(grid);
      continue;
    }

    if (b.kind === "highlight") {
      closeSection();
      const tone = b.tone ?? "owe";
      const box = el("div", {
        borderRadius: "20px",
        border: `1px solid ${TONE_BORDER[tone]}`,
        background: TONE_SOFT[tone],
        padding: "16px 18px",
      });

      const lab = el("div", {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: TONE[tone],
        opacity: "0.9",
        lineHeight: "1.2",
      });
      const hIc = el("span", { display: "inline-flex", color: TONE[tone], flexShrink: "0" });
      hIc.innerHTML = iconSvg(b.icon ?? "wallet", 16);
      lab.append(hIc, document.createTextNode(b.label));

      const val = el("div", {
        fontFamily: FONT_DISPLAY,
        fontSize: "34px",
        fontWeight: "800",
        letterSpacing: "-0.03em",
        marginTop: "4px",
        lineHeight: "1.1",
        color: TONE[tone],
        fontVariantNumeric: "tabular-nums",
      });
      val.textContent = b.value;

      box.append(lab, val);
      if (b.hint) {
        const hint = el("div", { marginTop: "4px", fontSize: "13px", color: C.inkSoft });
        hint.textContent = b.hint;
        box.appendChild(hint);
      }
      stack.appendChild(box);
      continue;
    }

    if (b.kind === "section") {
      openSection(b.title, b.icon);
      continue;
    }

    if (b.kind === "kv") {
      const activeList = section.list;
      const inSection = Boolean(activeList);
      if (!inSection) closeSection();

      const row = el("div", {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        padding: inSection ? "10px 12px" : "14px 16px",
        borderRadius: inSection ? "16px" : "20px",
        border: `1px solid ${C.line}`,
        background: inSection ? C.surface2 : C.surface,
        boxShadow: inSection ? "none" : SHADOW_CARD,
      });

      const l = el("span", {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "14px",
        color: C.inkSoft,
        fontWeight: "600",
      });
      if (b.icon) {
        const kIc = el("span", { display: "inline-flex", color: C.inkFaint, flexShrink: "0" });
        kIc.innerHTML = iconSvg(b.icon, 14);
        l.appendChild(kIc);
      }
      l.appendChild(document.createTextNode(b.label));

      const v = el("span", {
        fontFamily: FONT_MONO,
        fontSize: inSection ? "14px" : "16px",
        fontWeight: "700",
        color: TONE[b.tone ?? "default"],
        fontVariantNumeric: "tabular-nums",
      });
      v.textContent = b.value;

      row.append(l, v);
      if (activeList) activeList.appendChild(row);
      else stack.appendChild(row);
      continue;
    }

    if (b.kind === "person") {
      const list = section.list ?? openSection("Daftar");

      // rounded-xl + border-line + bg-surface-2 + p-3, sama seperti baris di web
      const row = el("div", {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        borderRadius: "16px",
        border: `1px solid ${C.line}`,
        background: C.surface2,
      });

      const rank = el("span", {
        fontFamily: FONT_DISPLAY,
        width: "16px",
        textAlign: "center",
        fontSize: "14px",
        fontWeight: "700",
        color: C.inkFaint,
        flexShrink: "0",
        fontVariantNumeric: "tabular-nums",
        lineHeight: "1",
      });
      rank.textContent = String(b.rank);

      const tone = b.rightTone ?? "court";
      row.append(
        rank,
        avatarNode({
          name: b.name,
          photo: b.photo,
          initial: b.initial,
          size: 36,
          tone,
          fontSize: 15,
        }),
      );

      const mid = el("div", { minWidth: "0", flex: "1" });

      const nameRow = el("div", {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: "0",
      });
      const name = el("div", {
        fontWeight: "600",
        fontSize: "16px",
        lineHeight: "1.25",
        color: C.ink,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: "0",
      });
      name.textContent = b.name;
      nameRow.appendChild(name);
      if (b.tag) {
        const tag = el("span", {
          flexShrink: "0",
          borderRadius: "999px",
          background: C.courtSoft,
          color: C.court,
          padding: "2px 7px",
          fontSize: "10px",
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          lineHeight: "1.4",
        });
        tag.textContent = b.tag;
        nameRow.appendChild(tag);
      }
      mid.appendChild(nameRow);

      if (b.chips?.length) mid.appendChild(chipRow(b.chips, C.inkFaint));
      else if (b.detail) {
        const detail = el("div", {
          marginTop: "2px",
          fontSize: "11px",
          color: C.inkFaint,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });
        detail.textContent = b.detail;
        mid.appendChild(detail);
      }

      const right = el("div", { flexShrink: "0", marginLeft: "4px" });

      if (isLunas(b.right)) {
        const badge = el("span", {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "14px",
          fontWeight: "700",
          color: C.paid,
          lineHeight: "1",
        });
        const cIc = el("span", { display: "inline-flex", color: C.paid });
        cIc.innerHTML = iconSvg("checkCircle", 14);
        badge.append(cIc, document.createTextNode("Lunas"));
        right.appendChild(badge);
      } else {
        const amt = el("div", {
          fontFamily: FONT_MONO,
          fontSize: "14px",
          fontWeight: "700",
          color: TONE[b.rightTone ?? "default"],
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        });
        amt.textContent = b.right;
        right.appendChild(amt);
      }

      row.append(mid, right);
      list.appendChild(row);
      continue;
    }

    if (b.kind === "footer") {
      closeSection();
      stack.appendChild(footerNode(b.text));
    }
  }

  closeSection();
  if (!hasFooter) stack.appendChild(footerNode());
  root.appendChild(stack);
  return root;
}

/** Footer — tagline web + alamat app, biar orang tahu buka di mana. */
function footerNode(text?: string): HTMLElement {
  const foot = el("div", {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "5px",
    padding: "2px 0 0",
  });

  const line = el("div", { fontSize: "12px", color: C.inkFaint, textAlign: "center" });
  line.textContent = text || `Kok Badminton · ${APP_TAGLINE}`;

  const link = el("div", {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    borderRadius: "999px",
    border: `1px solid ${C.line}`,
    background: C.surface,
    color: C.courtDeep,
    padding: "5px 12px",
    fontFamily: FONT_MONO,
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "1.2",
    boxShadow: SHADOW_CARD,
  });
  const lIc = el("span", { display: "inline-flex", color: C.court });
  lIc.innerHTML = iconSvg("shuttle", 13);
  link.append(lIc, document.createTextNode(APP_HOST));

  foot.append(line, link);
  return foot;
}

/** Render kartu share ke PNG blob (DOM → html-to-image, senada web). */
export async function renderShareCard(blocks: ShareCardBlock[]): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("Hanya di browser");

  const card = buildShareDom(blocks);
  // Wrapper off-screen: card sendiri tetap `position: static` biar hasil
  // snapshot-nya gak kegeser (lihat catatan di buildShareDom).
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;pointer-events:none";
  host.appendChild(card);
  document.body.appendChild(host);

  try {
    // pastikan font + foto ter-decode sebelum snapshot
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(
      [...card.querySelectorAll("img")].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.onload = () => r();
              img.onerror = () => r();
            }),
      ),
    );
    // double rAF biar layout stabil
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const blob = await toBlob(card, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: C.bg,
      // skip external resources yang bisa gagal
      filter: (node) => {
        if (node instanceof HTMLElement && node.tagName === "LINK") return false;
        return true;
      },
    });

    if (!blob) throw new Error("Gagal encode PNG");
    return blob;
  } finally {
    host.remove();
  }
}
