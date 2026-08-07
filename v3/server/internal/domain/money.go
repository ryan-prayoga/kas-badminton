package domain

// PerPersonCost membagi total rupiah ke n orang, dibulatkan ke ATAS ke
// ratusan rupiah (PLAN.md §9.5 aturan A):
//
//	perOrang = ceilRatusan(total / n)
//
// Contoh: total 10.000 dibagi 3 → 3.333,33 → Rp 3.400 per orang.
//
// Dihitung murni pakai integer (invarian §3.1: uang tidak pernah float):
// perOrang adalah kelipatan 100 terkecil p sehingga p × n ≥ total, yaitu
// p = 100 × ceilDiv(total, 100×n).
func PerPersonCost(total int64, n int) int64 {
	if n <= 0 {
		n = 1
	}
	if total <= 0 {
		return 0
	}
	step := int64(100 * n)
	return 100 * ceilDiv(total, step)
}

// Rounding balik selisih pembulatan (§9.5 A): perPerson×n − total. Kelebihan
// ini masuk kas, dicatat sebagai "pembulatan" — tidak boleh menyatu diam-diam.
func Rounding(perPerson int64, n int, total int64) int64 {
	return perPerson*int64(n) - total
}

func ceilDiv(a, b int64) int64 {
	if b <= 0 {
		return 0
	}
	if a <= 0 {
		return 0
	}
	return (a + b - 1) / b
}
