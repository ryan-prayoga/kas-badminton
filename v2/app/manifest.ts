import type { MetadataRoute } from "next";

/**
 * iOS 16.4+ baca manifest buat mode standalone + warna layar peluncuran.
 * `background_color` dipakai Safari sebagai latar splash saat app dibuka dari
 * home screen — samain sama `--bg` light biar gak ada kedip putih.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kok Badminton",
    short_name: "Kok",
    description: "Kas patungan kok badminton — matchup, tagihan, dan setelan, realtime.",
    lang: "id",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef2f8",
    theme_color: "#eef2f8",
    categories: ["sports", "finance", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
