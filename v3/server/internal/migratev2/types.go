// Package migratev2 membaca database v2 (Prisma/Postgres, skema JSON
// blob — v2/prisma/schema.prisma) dan menulisnya ke v3 sebagai klub
// pertama (PLAN.md §14 F10). Cakupan pass ini: pemain, jenis kok, main
// harian, pengeluaran, titipan (carry) → dompet awal. TURNAMEN BELUM
// TERMASUK — bagan v2 (lib/domain/tournament.ts, ~800 baris logic murni)
// butuh porting terpisah yang diuji seketat ini sebelum ikut; migrasi
// main harian (paling kritis buat uang) sudah utuh & terverifikasi lebih
// dulu di sini.
//
// v2 TIDAK PERNAH disentuh — package ini cuma database/sql SELECT
// read-only ke DB v2 (reader.go), tidak pernah menulis ke sana (PLAN.md
// §0 "Jangan menyentuh v2/ sama sekali" — itu soal kode, tapi semangatnya
// sama buat datanya: v2 tetap jalan produksi sampai cutover sungguhan).
package migratev2

import "time"

// V2Player — baris tabel `players` v2 (name PK, prisma schema.prisma).
type V2Player struct {
	Name  string
	Photo *string
}

// V2Carry — baris `player_carry` (name PK). Carry POSITIF = kredit/titipan
// yang MENGURANGI tagihan (lib/domain/debt.ts: "total = max(0, owedGross
// − carry)") — makanya jadi saldo DEPOSIT di v3, bukan utang.
type V2Carry struct {
	Name  string
	Carry int64
}

// V2KokType — baris `kok_types`.
type V2KokType struct {
	ID             string
	Name           string
	PricePerPerson int64
	PricePerSlop   int64
	Stock          int32
	Active         bool
}

// V2GamePlayer — satu elemen `games.players` (JSON, lib/domain/types.ts
// Player). Selalu tepat 4 per game di v2 (normalizeStoredGame memaksa
// itu) — verify.go menolak game yang menyimpang dari itu alih-alih
// menebak-nebak.
type V2GamePlayer struct {
	Name   string
	Paid   bool
	PaidAt *time.Time
	PaidBy *string
}

// V2GameKok — satu elemen `games.koks` (JSON, lib/domain/types.ts Kok).
// TypeID/TypeName NULL = kok generik tanpa jenis tercatat (data lama).
type V2GameKok struct {
	TypeID         *string
	TypeName       *string
	PricePerPerson int64
}

// V2Game — baris `games`. Skor SENGAJA tidak ada field-nya di sini — v2
// tidak pernah menyimpan skor main harian (lib/domain/types.ts komentar
// "skor sudah tidak dipakai"; kolom `scores` di Prisma cuma sisa migrasi
// lama yang tidak pernah diisi lagi). Itu murni fitur BARU v3 (§8.3).
type V2Game struct {
	ID         string
	Date       string // YYYY-MM-DD
	Players    []V2GamePlayer
	Koks       []V2GameKok
	Notes      *string
	RecordedBy *string // nama bebas, bisa kosong/tidak cocok siapa pun
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// V2Expense — baris `expenses`. Tidak ada kolom recorded_by di v2 sama
// sekali buat pengeluaran (beda dari games/tournaments) — migrasi.go
// selalu menulis NULL di sana, bukan keterbatasan migrasi tapi memang
// datanya tidak pernah ada.
type V2Expense struct {
	ID        string
	TypeID    *string
	TypeName  *string
	Slops     int32
	Amount    int64
	CreatedAt time.Time
}
