// Share teks / gambar — kartu PNG di-render dari DOM senada UI web (Court Ledger).

import { toBlob } from "html-to-image";

export type ShareCardTone = "default" | "paid" | "owe" | "danger" | "muted" | "court";

export type ShareMetric = {
  label: string;
  value: string;
  tone?: ShareCardTone;
  /** Subteks kecil di bawah value (mirip StatCard web). */
  sub?: string;
};

export type ShareCardBlock =
  | { kind: "header"; title: string; subtitle?: string }
  | { kind: "metrics"; items: ShareMetric[] }
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
      initial?: string;
    }
  | { kind: "footer"; text: string };

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

const FONT_SANS = 'var(--font-hanken), "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif';
const FONT_DISPLAY = 'var(--font-archivo), Archivo, ui-sans-serif, system-ui, sans-serif';
const FONT_MONO = 'var(--font-jbmono), "JetBrains Mono", ui-monospace, monospace';

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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLunas(right: string): boolean {
  return /^lunas$/i.test(right.trim());
}

/** SVG ikon sederhana (inline) — senada mdi outline di web. */
const ICONS = {
  racket: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><ellipse cx="12" cy="8" rx="6" ry="7"/><path d="M12 15v6M9 21h6"/><path d="M9 6h6M12 3v10" opacity=".35"/></svg>`,
  cash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>`,
  trophy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 5h2a2 2 0 012 2v1a4 4 0 01-4 4M7 5H5a2 2 0 00-2 2v1a4 4 0 004 4"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  calendar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>`,
};

function toneIconColor(tone: ShareCardTone): string {
  return TONE[tone];
}

function buildShareDom(blocks: ShareCardBlock[]): HTMLElement {
  const header = blocks.find((b) => b.kind === "header") as
    | Extract<ShareCardBlock, { kind: "header" }>
    | undefined;
  const body = blocks.filter((b) => b.kind !== "header");

  const root = document.createElement("div");
  root.setAttribute("data-share-card", "1");
  // Off-screen tapi di layout (html-to-image butuh ukuran nyata)
  root.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "width:600px",
    "box-sizing:border-box",
    "padding:20px",
    `font-family:${FONT_SANS}`,
    `color:${C.ink}`,
    `background:radial-gradient(120% 80% at 50% -20%, rgba(21, 96, 214, 0.10), transparent 55%), ${C.bg}`,
    "-webkit-font-smoothing:antialiased",
  ].join(";");

  const stack = document.createElement("div");
  Object.assign(stack.style, {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  });

  // ── App header (mirip AppFrame) ──
  const appHeader = document.createElement("div");
  Object.assign(appHeader.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "16px",
    borderRadius: "20px",
    border: `1px solid ${C.line}`,
    background: C.surface,
    boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px -14px rgba(15,27,45,0.18)",
  });

  const logo = document.createElement("div");
  Object.assign(logo.style, {
    width: "44px",
    height: "44px",
    borderRadius: "16px",
    background: C.court,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    flexShrink: "0",
    boxShadow: "0 10px 30px -12px rgba(21,96,214,0.45)",
  });
  logo.innerHTML = ICONS.racket;

  const headText = document.createElement("div");
  headText.style.minWidth = "0";
  headText.style.flex = "1";

  // Samakan AppFrame: eyebrow (konteks) + "Kok Badminton" sebagai judul
  const eyebrow = document.createElement("div");
  Object.assign(eyebrow.style, {
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: C.inkFaint,
    marginBottom: "2px",
  });
  const eyebrowBits = [header?.title, header?.subtitle].filter(Boolean);
  eyebrow.textContent = (eyebrowBits.join(" · ") || "Kok Badminton").toUpperCase();

  const title = document.createElement("div");
  Object.assign(title.style, {
    fontFamily: FONT_DISPLAY,
    fontSize: "22px",
    fontWeight: "800",
    letterSpacing: "-0.02em",
    lineHeight: "1.15",
    color: C.ink,
  });
  title.textContent = "Kok Badminton";

  headText.append(eyebrow, title);
  appHeader.append(logo, headText);
  stack.appendChild(appHeader);

  // ── Body blocks ──
  // object mutable — biar TS gak “mengunci” sectionList ke null lewat closure
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

  const openSection = (sectionTitle: string): HTMLElement => {
    closeSection();
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      borderRadius: "20px",
      border: `1px solid ${C.line}`,
      background: C.surface,
      padding: "16px",
      boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px -14px rgba(15,27,45,0.18)",
    });

    const head = document.createElement("div");
    Object.assign(head.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginBottom: "12px",
    });

    const iconBox = document.createElement("span");
    Object.assign(iconBox.style, {
      width: "28px",
      height: "28px",
      borderRadius: "10px",
      background: C.courtSoft,
      color: C.court,
      display: "grid",
      placeItems: "center",
      flexShrink: "0",
    });
    iconBox.innerHTML = ICONS.trophy;

    const h = document.createElement("div");
    Object.assign(h.style, {
      fontFamily: FONT_DISPLAY,
      fontSize: "16px",
      fontWeight: "700",
      letterSpacing: "-0.01em",
      color: C.ink,
    });
    h.textContent = sectionTitle;

    head.append(iconBox, h);
    wrap.appendChild(head);

    const list = document.createElement("div");
    Object.assign(list.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    section.wrap = wrap;
    section.list = list;
    return list;
  };

  for (const b of body) {
    if (b.kind === "metrics") {
      closeSection();
      const grid = document.createElement("div");
      Object.assign(grid.style, {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
      });

      for (const item of b.items) {
        const tone = item.tone ?? "default";
        const card = document.createElement("div");
        Object.assign(card.style, {
          borderRadius: "20px",
          border: `1px solid ${C.line}`,
          background: C.surface,
          padding: "14px",
          boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px -14px rgba(15,27,45,0.18)",
        });

        const lab = document.createElement("div");
        Object.assign(lab.style, {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
          fontWeight: "700",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.inkFaint,
        });
        const ic = document.createElement("span");
        ic.style.color = toneIconColor(tone);
        ic.style.display = "grid";
        ic.innerHTML = ICONS.cash;
        lab.append(ic, document.createTextNode(item.label));

        const val = document.createElement("div");
        Object.assign(val.style, {
          fontFamily: FONT_DISPLAY,
          fontSize: "24px",
          fontWeight: "800",
          letterSpacing: "-0.02em",
          marginTop: "6px",
          color: TONE[tone],
          fontVariantNumeric: "tabular-nums",
        });
        val.textContent = item.value;

        card.append(lab, val);
        if (item.sub) {
          const sub = document.createElement("div");
          Object.assign(sub.style, {
            marginTop: "2px",
            fontSize: "12px",
            color: C.inkSoft,
          });
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
      const soft =
        tone === "paid"
          ? C.paidSoft
          : tone === "danger"
            ? C.dangerSoft
            : tone === "court"
              ? C.courtSoft
              : C.oweSoft;
      const border =
        tone === "paid"
          ? "rgba(15,138,91,0.25)"
          : tone === "danger"
            ? "rgba(220,38,38,0.25)"
            : "rgba(185,102,8,0.25)";

      const box = document.createElement("div");
      Object.assign(box.style, {
        borderRadius: "20px",
        border: `1px solid ${border}`,
        background: soft,
        padding: "16px 18px",
      });

      const lab = document.createElement("div");
      Object.assign(lab.style, {
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: TONE[tone],
        opacity: "0.85",
      });
      lab.textContent = b.label;

      const val = document.createElement("div");
      Object.assign(val.style, {
        fontFamily: FONT_MONO,
        fontSize: "32px",
        fontWeight: "800",
        marginTop: "6px",
        color: TONE[tone],
        fontVariantNumeric: "tabular-nums",
      });
      val.textContent = b.value;

      box.append(lab, val);
      if (b.hint) {
        const hint = document.createElement("div");
        Object.assign(hint.style, {
          marginTop: "4px",
          fontSize: "13px",
          color: C.inkSoft,
        });
        hint.textContent = b.hint;
        box.appendChild(hint);
      }
      stack.appendChild(box);
      continue;
    }

    if (b.kind === "section") {
      openSection(b.title);
      continue;
    }

    if (b.kind === "kv") {
      // kv di luar section → kartu kecil; di dalam section → baris
      const activeList = section.list;
      if (activeList) {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          padding: "10px 12px",
          borderRadius: "12px",
          border: `1px solid ${C.line}`,
          background: C.surface2,
        });
        const l = document.createElement("span");
        Object.assign(l.style, { fontSize: "14px", color: C.inkSoft, fontWeight: "600" });
        l.textContent = b.label;
        const v = document.createElement("span");
        Object.assign(v.style, {
          fontFamily: FONT_MONO,
          fontSize: "14px",
          fontWeight: "700",
          color: TONE[b.tone ?? "default"],
          fontVariantNumeric: "tabular-nums",
        });
        v.textContent = b.value;
        row.append(l, v);
        activeList.appendChild(row);
      } else {
        closeSection();
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          borderRadius: "16px",
          border: `1px solid ${C.line}`,
          background: C.surface,
          boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px -14px rgba(15,27,45,0.18)",
        });
        const l = document.createElement("span");
        Object.assign(l.style, { fontSize: "14px", color: C.inkSoft, fontWeight: "600" });
        l.textContent = b.label;
        const v = document.createElement("span");
        Object.assign(v.style, {
          fontFamily: FONT_MONO,
          fontSize: "16px",
          fontWeight: "800",
          color: TONE[b.tone ?? "default"],
        });
        v.textContent = b.value;
        row.append(l, v);
        stack.appendChild(row);
      }
      continue;
    }

    if (b.kind === "person") {
      const list = section.list ?? openSection("Daftar");

      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        borderRadius: "14px",
        border: `1px solid ${C.line}`,
        background: C.surface2,
      });

      const rank = document.createElement("span");
      Object.assign(rank.style, {
        fontFamily: FONT_DISPLAY,
        width: "18px",
        textAlign: "center",
        fontSize: "13px",
        fontWeight: "700",
        color: C.inkFaint,
        flexShrink: "0",
        fontVariantNumeric: "tabular-nums",
      });
      rank.textContent = String(b.rank);

      const tone = b.rightTone ?? "court";
      const avBg =
        tone === "owe" ? C.oweSoft : tone === "paid" ? C.paidSoft : C.courtSoft;
      const avFg = TONE[tone === "default" ? "court" : tone];

      const av = document.createElement("div");
      Object.assign(av.style, {
        width: "36px",
        height: "36px",
        borderRadius: "999px",
        background: avBg,
        color: avFg,
        display: "grid",
        placeItems: "center",
        fontFamily: FONT_DISPLAY,
        fontWeight: "800",
        fontSize: "14px",
        flexShrink: "0",
        border: `1px solid ${C.lineStrong}`,
      });
      av.textContent = (b.initial || b.name || "?").slice(0, 1).toUpperCase();

      const mid = document.createElement("div");
      Object.assign(mid.style, { minWidth: "0", flex: "1" });

      const name = document.createElement("div");
      Object.assign(name.style, {
        fontWeight: "600",
        fontSize: "15px",
        color: C.ink,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      name.textContent = b.name;

      const detail = document.createElement("div");
      Object.assign(detail.style, {
        marginTop: "2px",
        fontSize: "11px",
        color: C.inkFaint,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      detail.textContent = b.detail;

      mid.append(name, detail);

      const right = document.createElement("div");
      right.style.flexShrink = "0";
      right.style.marginLeft = "4px";

      if (isLunas(b.right)) {
        const badge = document.createElement("span");
        Object.assign(badge.style, {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "13px",
          fontWeight: "700",
          color: C.paid,
        });
        badge.innerHTML = `${ICONS.check}<span>Lunas</span>`;
        right.appendChild(badge);
      } else {
        const amt = document.createElement("div");
        Object.assign(amt.style, {
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

      row.append(rank, av, mid, right);
      list.appendChild(row);
      continue;
    }

    if (b.kind === "footer") {
      closeSection();
      const foot = document.createElement("div");
      Object.assign(foot.style, {
        textAlign: "center",
        fontSize: "12px",
        color: C.inkFaint,
        padding: "4px 0 2px",
      });
      foot.textContent = b.text || "Kok Badminton · dibuat buat patungan yang rapi";
      stack.appendChild(foot);
    }
  }

  closeSection();
  root.appendChild(stack);

  // silence unused esc if not needed — keep for future HTML inject
  void esc;
  return root;
}

/** Render kartu share ke PNG blob (DOM → html-to-image, senada web). */
export async function renderShareCard(blocks: ShareCardBlock[]): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("Hanya di browser");

  const el = buildShareDom(blocks);
  document.body.appendChild(el);

  try {
    // pastikan font + layout settle
    if (document.fonts?.ready) await document.fonts.ready;
    // double rAF biar layout stabil
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const blob = await toBlob(el, {
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
    el.remove();
  }
}
