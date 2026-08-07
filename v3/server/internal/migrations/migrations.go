// Package migrations meng-embed berkas migrasi goose ke dalam binary Go
// (pola sama dengan internal/webassets) — cmd/migrate menjalankannya tanpa
// butuh CLI goose atau berkas terpisah di image produksi (PLAN.md §4.1).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
