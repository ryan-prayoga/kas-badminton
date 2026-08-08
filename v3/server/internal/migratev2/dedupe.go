package migratev2

import (
	"sort"
	"strings"
)

// NormalizeName — port persis lib/domain/game.ts normalizeName (v2):
// trim + kolaps spasi ganda. Dipakai buat KUNCI PERBANDINGAN (dedupe,
// pencarian nama antar sumber game/carry/players) — bukan buat nama
// tampil, itu tetap versi asli/kanonik dari mapping.
func NormalizeName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

// foldCompare — bentuk yang dipakai KHUSUS buat mendeteksi kemiripan
// (case-insensitive di atas NormalizeName). "Rian" vs "rian" harus
// kedeteksi walau NormalizeName sendiri case-sensitive (nama tampil
// tetap mempertahankan huruf besar/kecil aslinya).
func foldCompare(name string) string {
	return strings.ToLower(NormalizeName(name))
}

// levenshtein — jarak edit klasik, DP O(n*m). Nama pemain pendek (~20
// karakter) jadi ini sama sekali tidak jadi masalah performa walau
// dipanggil O(n²) kali di Cluster.
func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	n, m := len(ra), len(rb)
	if n == 0 {
		return m
	}
	if m == 0 {
		return n
	}
	prev := make([]int, m+1)
	curr := make([]int, m+1)
	for j := 0; j <= m; j++ {
		prev[j] = j
	}
	for i := 1; i <= n; i++ {
		curr[0] = i
		for j := 1; j <= m; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			min := del
			if ins < min {
				min = ins
			}
			if sub < min {
				min = sub
			}
			curr[j] = min
		}
		prev, curr = curr, prev
	}
	return prev[m]
}

// Cluster — sekelompok nama v2 mentah yang MUNGKIN orang yang sama
// (jarak edit kecil setelah dilipat huruf kecil, atau satu adalah
// substring kata dari yang lain — "Made" vs "Made Wijaya"). Bukan
// keputusan otomatis — manusia yang memutuskan lewat berkas pemetaan
// (§14 F10 "Manusia yang memutuskan mana yang digabung — bukan tebakan
// otomatis").
type Cluster struct {
	Names []string
}

// maxEditDistanceForLen — ambang jarak edit yang masih dianggap "mirip".
// LEBIH KETAT dari perkiraan awal — dicoba di data seed lokal
// (kok_badminton dev DB, 36 nama Indonesia pendek) dan ambang longgar
// (≤2 buat nama ≤8 huruf) ternyata menangkap banyak PASANGAN YANG JELAS
// BEDA ORANG ("Cahyo"/"Yahya", "Nanda"/"Sandi", "Danar"/"Fajar") — nama
// pendek 5-6 huruf gampang berjarak 2 tanpa ada hubungan apa pun.
// Ambangnya diperketat sampai laporan asli jadi bersih (cuma "Made"/
// "Made Wijaya" yang lolos, kasus PREFIX yang memang layak ditanyakan
// manusia — bukan jarak edit sama sekali).
func maxEditDistanceForLen(l int) int {
	switch {
	case l <= 5:
		return 1
	default:
		return 2
	}
}

// looksSimilar — DUA aturan, OR: (1) jarak edit di bawah ambang skala
// panjang, buat menangkap typo/beda kapitalisasi/spasi ("rian" vs
// "Rian ", "Krisna" vs "Krisan"); (2) satu nama adalah PREFIX kata dari
// yang lain ("Made" vs "Made Wijaya") — kasus nyata yang ditemukan di
// data seed lokal (kok_badminton dev DB), BUKAN kasus rekaan.
func looksSimilar(a, b string) bool {
	fa, fb := foldCompare(a), foldCompare(b)
	if fa == fb {
		return true
	}
	shorter, longer := fa, fb
	if len(shorter) > len(longer) {
		shorter, longer = longer, shorter
	}
	if strings.HasPrefix(longer, shorter+" ") {
		return true
	}
	maxLen := len(fa)
	if len(fb) > maxLen {
		maxLen = len(fb)
	}
	return levenshtein(fa, fb) <= maxEditDistanceForLen(maxLen)
}

// ClusterNames — mengelompokkan nama-nama yang MUNGKIN sama orang
// (union-find sederhana lewat looksSimilar berpasangan). Hasilnya
// deterministik (urut alfabet) supaya laporan `migrate-v2 dedupe` stabil
// dijalankan ulang — gampang di-diff kalau data v2 berubah sedikit.
// Cluster berisi SATU nama (tidak ada yang mirip) TIDAK ikut dikembalikan
// — laporan cuma perlu menyorot yang benar-benar butuh keputusan manusia.
func ClusterNames(names []string) []Cluster {
	uniq := map[string]bool{}
	var list []string
	for _, n := range names {
		norm := NormalizeName(n)
		if norm == "" || uniq[norm] {
			continue
		}
		uniq[norm] = true
		list = append(list, norm)
	}
	sort.Strings(list)

	parent := make([]int, len(list))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[ra] = rb
		}
	}

	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if looksSimilar(list[i], list[j]) {
				union(i, j)
			}
		}
	}

	groups := map[int][]string{}
	for i, n := range list {
		root := find(i)
		groups[root] = append(groups[root], n)
	}

	var clusters []Cluster
	for _, names := range groups {
		if len(names) < 2 {
			continue
		}
		sort.Strings(names)
		clusters = append(clusters, Cluster{Names: names})
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Names[0] < clusters[j].Names[0] })
	return clusters
}
