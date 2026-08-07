// Package domain berisi logika murni v3 — tidak ada I/O, tidak ada DB, tidak
// ada HTTP. Port test-first dari v2/lib/domain (PLAN.md §14 F1), diadaptasi ke
// tiga keputusan v3 yang tidak ada di v2:
//
//  1. Jumlah pemain per game bebas, bukan konstanta 4 (§8).
//  2. Pembagian biaya dibulatkan ke atas ke ratusan rupiah, kelebihan masuk
//     kas sebagai "pembulatan" (§9.5 aturan A) — lihat money.go.
//  3. Uang selalu int64 rupiah, tidak pernah float (invarian §3.1).
//
// Karena itu Kok.Price di sini adalah harga TOTAL satu kok (bukan harga per
// orang seperti Kok.pricePerPerson di v2, yang diam-diam mengasumsikan selalu
// dibagi 4).
package domain

// --- Main harian ---

type Player struct {
	Name   string
	Paid   bool
	PaidAt string // kosong = belum bayar / tidak relevan
	PaidBy string
}

type Kok struct {
	ID       string
	TypeID   string // kosong = tidak terikat KokType
	TypeName string
	// Harga TOTAL kok ini (rupiah). Dibagi ke jumlah pemain sebenarnya saat
	// dihitung biaya per orang — lihat PerPersonCost di money.go.
	Price int64
}

type StoredGame struct {
	ID         string
	Date       string
	Players    []Player
	Koks       []Kok
	Notes      string
	RecordedBy string
	CreatedAt  string
	UpdatedAt  string
}

// GameCost adalah hasil pembagian biaya satu game (§9.5 aturan A).
type GameCost struct {
	PerPerson   int64
	Total       int64 // jumlah harga semua kok, sebelum pembulatan
	PlayerCount int
	KokCount    int
	// PerPerson × PlayerCount − Total: kelebihan pembulatan yang masuk kas,
	// dicatat sebagai "pembulatan" (bukan menyatu diam-diam ke total).
	Rounding int64
}

type EnrichedPlayer struct {
	Player
	Amount int64
}

type GameSummary struct {
	PaidCount   int
	UnpaidCount int
	PaidTotal   int64
	UnpaidTotal int64
	AllPaid     bool
}

type EnrichedGame struct {
	StoredGame
	Players []EnrichedPlayer
	Cost    GameCost
	Summary GameSummary
}

// --- Hutang & cicilan ---

type DebtKind string

const (
	DebtKindGame        DebtKind = "game"
	DebtKindTurnamenKok DebtKind = "turnamen_kok"
)

type DebtItem struct {
	// id game, atau "{tournamentId}::{matchId}" (kind turnamen_kok).
	GameID   string
	Date     string
	Name     string
	Amount   int64
	KokCount int
	Kind     DebtKind
	// Nama turnamen · judul partai (kind turnamen_kok saja).
	Label       string
	CreatedAt   string
	MatchNumber int // 0 = tidak berlaku (cuma dipakai kind game)
}

type DebtEntry struct {
	Name      string
	OwedGross int64
	Items     []DebtItem
	Carry     int64
	Total     int64
}

type CarryMap map[string]int64

// TouchedSlot menunjuk satu tagihan yang tersentuh planner best-fit.
type TouchedSlot struct {
	Kind DebtKind
	// id game, atau id turnamen (kind turnamen_kok).
	ID    string
	Index int
	// Cuma dipakai kind turnamen_kok — id partai yang kok-nya ditagih.
	MatchID string
}

type SettlePlan struct {
	Touched []TouchedSlot
	// Saldo carry setelah rencana ini dijalankan. HasCarryAfter=false berarti
	// entri carry dihapus (bukan di-set 0) — beda makna dari titipan 0 rupiah.
	CarryAfter    int64
	HasCarryAfter bool
	PaymentAmount int64
	ClearsDebt    bool
}
