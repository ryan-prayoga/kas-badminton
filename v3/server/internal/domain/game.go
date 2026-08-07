// Port dari v2/lib/domain/game.ts (gameCost, enrichGame), diadaptasi ke
// jumlah pemain bebas (PLAN.md §8) dan pembagian biaya dibulatkan (§9.5 A).
package domain

import "fmt"

// GameScoreFormat — skor main harian OPSIONAL (§8.3). Beda dari
// tournament.ScoreFormat (cuma single/bo3) karena main harian punya format
// tambahan "rally42" (tarkam, pindah tempat di 21) yang tidak dipakai
// turnamen — lihat DDL.sql tipe score_format yang mencakup ketiganya.
type GameScoreFormat string

const (
	GameScoreSingle  GameScoreFormat = "single"
	GameScoreBo3     GameScoreFormat = "bo3"
	GameScoreRally42 GameScoreFormat = "rally42"
)

// GameSetScore — satu game/set di dalam MatchScore (nama beda dari
// tournament.GameScore biar tidak diimpor silang, tapi bentuknya identik —
// "berbagi satu model skor" §8.3).
type GameSetScore struct{ A, B int }

// GameWinnerSide menghitung sisi menang dari skor opsional main harian.
// single & rally42 selalu tepat satu set (game_scores CHECK game_no
// BETWEEN 1 AND 3, tapi keduanya cuma pernah punya satu baris — lihat
// DDL.sql §8.3); bo3 1-3 set, menang lewat jumlah set yang dimenangkan.
// Badminton tidak kenal seri — set dengan skor sama ditolak sebagai input
// tidak valid, bukan ditebak.
func GameWinnerSide(format GameScoreFormat, sets []GameSetScore) (Side, error) {
	switch format {
	case GameScoreSingle, GameScoreRally42:
		if len(sets) != 1 {
			return "", fmt.Errorf("format %s harus tepat satu set skor", format)
		}
	case GameScoreBo3:
		if len(sets) < 1 || len(sets) > 3 {
			return "", fmt.Errorf("format bo3 butuh 1-3 set skor")
		}
	default:
		return "", fmt.Errorf("format skor %q tidak dikenal", format)
	}

	setsWonA, setsWonB := 0, 0
	for _, s := range sets {
		if s.A < 0 || s.B < 0 {
			return "", fmt.Errorf("skor tidak boleh negatif")
		}
		if s.A == s.B {
			return "", fmt.Errorf("skor %d-%d seri — badminton tidak kenal hasil imbang", s.A, s.B)
		}
		if s.A > s.B {
			setsWonA++
		} else {
			setsWonB++
		}
	}
	if setsWonA > setsWonB {
		return SideA, nil
	}
	return SideB, nil
}

// GameCostOf menghitung biaya satu game dari kok yang dipakai dan jumlah
// pemain sebenarnya. Tanpa kok atau tanpa pemain → nol, bukan divide-by-zero.
func GameCostOf(koks []Kok, playerCount int) GameCost {
	var total int64
	for _, k := range koks {
		total += k.Price
	}
	if playerCount <= 0 {
		return GameCost{PerPerson: 0, Total: total, PlayerCount: playerCount, KokCount: len(koks), Rounding: 0}
	}
	perPerson := PerPersonCost(total, playerCount)
	return GameCost{
		PerPerson:   perPerson,
		Total:       total,
		PlayerCount: playerCount,
		KokCount:    len(koks),
		Rounding:    Rounding(perPerson, playerCount, total),
	}
}

// EnrichGame melekatkan biaya dan ringkasan bayar ke satu game tersimpan.
func EnrichGame(g StoredGame) EnrichedGame {
	cost := GameCostOf(g.Koks, len(g.Players))

	players := make([]EnrichedPlayer, len(g.Players))
	paidCount := 0
	var paidTotal int64
	for i, p := range g.Players {
		players[i] = EnrichedPlayer{Player: p, Amount: cost.PerPerson}
		if p.Paid {
			paidCount++
			paidTotal += cost.PerPerson
		}
	}

	return EnrichedGame{
		StoredGame: g,
		Players:    players,
		Cost:       cost,
		Summary: GameSummary{
			PaidCount:   paidCount,
			UnpaidCount: len(players) - paidCount,
			PaidTotal:   paidTotal,
			UnpaidTotal: cost.Total + cost.Rounding - paidTotal,
			AllPaid:     len(players) > 0 && paidCount == len(players),
		},
	}
}

// GameMatchNumbers menomori game per hari (Partai 1, 2, ...) urut createdAt
// paling lama duluan — dipakai di rekap/riwayat biar nomornya konsisten.
func GameMatchNumbers(games []StoredGame) map[string]int {
	byDate := map[string][]StoredGame{}
	for _, g := range games {
		byDate[g.Date] = append(byDate[g.Date], g)
	}
	out := map[string]int{}
	for _, list := range byDate {
		sorted := append([]StoredGame(nil), list...)
		sortByCreatedAt(sorted)
		for i, g := range sorted {
			out[g.ID] = i + 1
		}
	}
	return out
}

func sortByCreatedAt(games []StoredGame) {
	// insertion sort — daftar per hari kecil, dan ini dipakai di F1 murni
	// buat kebutuhan tes; ganti ke sort.Slice kalau nanti dipakai di jalur panas.
	for i := 1; i < len(games); i++ {
		j := i
		for j > 0 && games[j-1].CreatedAt > games[j].CreatedAt {
			games[j-1], games[j] = games[j], games[j-1]
			j--
		}
	}
}
