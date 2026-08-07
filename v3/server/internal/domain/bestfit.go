package domain

// bestFitPlan pilih kombinasi ref yang paling pas menutup credit yang
// tersedia — greedy: tiap langkah ambil ref ber-amount ≤ credit dengan
// selisih (credit−amount) paling kecil; seri dipecahkan oleh orderKey
// (dipakai buat "yang paling lama menang", ISO date/createdAt string
// concatenation biar perbandingan leksikografis = kronologis).
//
// Satu algoritma dipakai untuk dua kebutuhan (PLAN.md §9.5 B): cicilan
// (debt.go) dan potong otomatis deposit (wallet.go). Port dari planInstallment
// v2/lib/domain/debt.ts, digeneralkan jadi generik.
func bestFitPlan[T any](refs []T, amountOf func(T) int64, orderKey func(T) string, credit int64) (touched []T, remaining int64) {
	pool := append([]T(nil), refs...)
	for {
		bestIdx := -1
		for i, r := range pool {
			amt := amountOf(r)
			if amt > credit {
				continue
			}
			if bestIdx == -1 {
				bestIdx = i
				continue
			}
			best := pool[bestIdx]
			diff := credit - amt
			bestDiff := credit - amountOf(best)
			if diff < bestDiff || (diff == bestDiff && orderKey(r) < orderKey(best)) {
				bestIdx = i
			}
		}
		if bestIdx == -1 {
			break
		}
		touched = append(touched, pool[bestIdx])
		credit -= amountOf(pool[bestIdx])
		pool = append(pool[:bestIdx], pool[bestIdx+1:]...)
	}
	return touched, credit
}
