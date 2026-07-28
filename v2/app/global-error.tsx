"use client";

import { useEffect } from "react";

/**
 * Root layout ikut kena error → `app/error.tsx` gak kepakai, yang dipakai ini.
 * Ganti seluruh <html>, jadi gak boleh nyender ke globals.css/komponen app;
 * style-nya inline biar tetap kebaca walau CSS gagal dimuat.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#eef2f8",
          color: "#0f1b2d",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>App gagal jalan</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#55647b", margin: "0 0 20px" }}>
            Kok Badminton kena error yang gak ketangkep. Muat ulang biasanya cukup.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 44,
                padding: "0 20px",
                border: 0,
                borderRadius: 12,
                background: "#1560d6",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Coba lagi
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 44,
                padding: "0 20px",
                borderRadius: 12,
                border: "1px solid #d3dcea",
                background: "#fff",
                color: "#0f1b2d",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Muat ulang app
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
