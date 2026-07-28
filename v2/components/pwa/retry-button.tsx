"use client";

import { useEffect, useState } from "react";

/** Reload manual + auto-reload begitu browser lapor online lagi. */
export function RetryButton() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        window.location.reload();
      }}
      className="inline-flex h-11 items-center justify-center rounded-xl bg-court px-5 text-sm font-semibold text-white shadow-court transition hover:bg-court-deep active:scale-95 disabled:opacity-60"
    >
      {busy ? "Memuat…" : "Coba lagi"}
    </button>
  );
}
