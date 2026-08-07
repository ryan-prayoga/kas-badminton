// Port dari v2/lib/domain/game.ts (gameCost, enrichGame), diadaptasi ke
// jumlah pemain bebas (PLAN.md §8) dan pembagian biaya dibulatkan (§9.5 A).
package domain

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
