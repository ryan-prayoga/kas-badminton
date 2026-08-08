// Package migratev2 membaca database v2 (Prisma/Postgres, skema JSON
// blob — v2/prisma/schema.prisma) dan menulisnya ke v3 sebagai klub
// pertama (PLAN.md §14 F10). Cakupan: pemain, jenis kok, main harian,
// pengeluaran, titipan (carry) → dompet awal, DAN turnamen (bagan/
// klasemen, skor, kok per-partai & umum, iuran) — bagan turnamen TIDAK
// dihitung ulang di sini; dipakai LANGSUNG internal/domain
// (BuildBracket/BuildRoundRobin lewat EnrichTournament, port 1:1 dari
// lib/domain/tournament.ts v2) supaya nol risiko re-implementasi yang
// diam-diam beda hasil dari yang sudah diuji lewat tournament_test.go.
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

// --- Turnamen (lib/domain/types.ts StoredTournament & isinya) ---

type V2Pair struct {
	ID   string
	Slot int
	A, B string // "" = slot BYE (knockout) / tidak ikut (round robin)
}

type V2GameScore struct{ A, B int }

type V2MatchScore struct {
	Format   string // "single" | "bo3"
	Games    []V2GameScore
	PlayedAt *string // YYYY-MM-DD
}

// V2TournamentKok — MatchID nil = kok umum turnamen (v2 TIDAK PERNAH
// menagihnya ke siapa pun — "lubang yang diakui", lihat komentar DDL.sql
// match_koks.match_id). Migrasi menutup lubang itu (tournament.go).
type V2TournamentKok struct {
	TypeID         *string
	TypeName       *string
	PricePerPerson int64
	MatchID        *string
	Date           string
}

type V2TournamentFee struct {
	Name   string
	Paid   bool
	PaidAt *string
	PaidBy *string
}

type V2Tournament struct {
	ID           string
	Name         string
	Date         string
	EndDate      *string
	Size         int
	Format       string // "knockout" | "round_robin"
	Fee          int64
	ScoreFormat  string // "single" | "bo3"
	Pairs        []V2Pair
	Results      map[string]V2MatchScore // matchId -> skor
	Koks         []V2TournamentKok
	Fees         []V2TournamentFee
	MatchKokPaid map[string][4]bool // matchId -> [sisiA.a, sisiA.b, sisiB.a, sisiB.b]
	Notes        *string
	RecordedBy   *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
