import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  // v2 nested di dalam repo lama → pin root biar tracing standalone benar
  outputFileTracingRoot: root,
  turbopack: { root },
  async headers() {
    return [
      {
        // SW gak boleh ke-cache: kalau basi, versi lama nyangkut di device
        // sampai user hapus app dari home screen.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
