import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  // v2 nested di dalam repo lama → pin root biar tracing standalone benar
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
