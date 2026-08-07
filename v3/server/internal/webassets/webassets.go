// Package webassets meng-embed SPA statis SvelteKit ke dalam binary Go
// (PLAN.md §4.1) — deploy jadi satu binary, tanpa runtime Node di server.
//
// dist/ berisi placeholder saat dev lokal (`go build` langsung); Dockerfile
// multi-stage menimpanya dengan hasil `npm run build` di web/ sebelum
// meng-compile binary produksi. Lihat dist/index.html dan v3/deploy/Dockerfile.
package webassets

import "embed"

//go:embed all:dist
var Dist embed.FS

// DistDir adalah nama sub-direktori di dalam Dist yang berisi berkas statis
// — dipakai untuk strip prefix saat membuat http.FileSystem.
const DistDir = "dist"
