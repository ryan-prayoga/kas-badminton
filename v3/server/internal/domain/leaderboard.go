// Papan peringkat klub (PLAN.md §8.3, §14 F7) — klasemen menang-kalah,
// rentetan kemenangan, dari skor main harian OPSIONAL. Baru muncul begitu
// ada main berskor; main tanpa skor sengaja tidak ikut kehitung sama
// sekali (tidak punya pemenang buat dibandingkan).
package domain

import "sort"

// PlayerGameResult — satu baris "orang ini di main itu, sisi X, pemenangnya
// sisi Y". Dipetik dari games+game_players (join di lapisan HTTP) —
// diurutkan menaik menurut tanggal SEBELUM dipanggil ke LeaderboardOf,
// supaya rentetan kemenangan terhitung benar (fungsi ini murni, tidak
// mengurutkan sendiri — biar jelas siapa yang bertanggung jawab atas
// urutan).
type PlayerGameResult struct {
	UserID     string
	PlayedOn   string // YYYY-MM-DD, dipakai cuma buat urutan yang stabil
	Side       Side
	WinnerSide Side
}

func (r PlayerGameResult) Won() bool { return r.WinnerSide != SideNil && r.Side == r.WinnerSide }

type LeaderboardRow struct {
	UserID string
	Played int
	Won    int
	Lost   int
	// CurrentStreak positif = sedang menang N kali berturut, negatif =
	// sedang kalah N kali berturut, 0 = belum pernah main.
	CurrentStreak    int
	LongestWinStreak int
}

// WinRatePermil — persentase menang dalam permil (per 1000), integer murni
// (invarian §3.1 sebenarnya cuma soal uang, tapi kebiasaan yang sama
// dipertahankan di sini: jangan float di mana pun perhitungannya bisa
// dibuat integer). Klien membaginya 10 buat dapat satu desimal persen.
func (r LeaderboardRow) WinRatePermil() int {
	if r.Played == 0 {
		return 0
	}
	return r.Won * 1000 / r.Played
}

// LeaderboardOf mengelompokkan hasil per user lalu menghitung rekap +
// rentetan. results HARUS sudah terurut menaik per tanggal (lihat komentar
// PlayerGameResult) — urutan dalam satu tanggal yang sama tidak berpengaruh
// ke total menang/kalah, cuma bisa sedikit menggeser rentetan kalau ada
// beberapa main di hari yang sama (dampaknya diterima, sama seperti v2
// tidak pernah membedakan urutan main dalam sehari).
//
// Baris diurutkan: menang terbanyak, lalu win rate, lalu jumlah main
// (main lebih banyak dianggap lebih "aktif" pada peringkat sama), lalu
// user_id supaya deterministik.
func LeaderboardOf(results []PlayerGameResult) []LeaderboardRow {
	order := []string{}
	rows := map[string]*LeaderboardRow{}
	streak := map[string]int{} // + = menang berturut, - = kalah berturut (state berjalan)

	rowFor := func(userID string) *LeaderboardRow {
		if r, ok := rows[userID]; ok {
			return r
		}
		r := &LeaderboardRow{UserID: userID}
		rows[userID] = r
		order = append(order, userID)
		return r
	}

	for _, res := range results {
		if res.WinnerSide == SideNil {
			continue // main belum ada pemenangnya (skor tidak valid) — dilewati
		}
		row := rowFor(res.UserID)
		row.Played++
		if res.Won() {
			row.Won++
			if streak[res.UserID] >= 0 {
				streak[res.UserID]++
			} else {
				streak[res.UserID] = 1
			}
		} else {
			row.Lost++
			if streak[res.UserID] <= 0 {
				streak[res.UserID]--
			} else {
				streak[res.UserID] = -1
			}
		}
		if streak[res.UserID] > row.LongestWinStreak {
			row.LongestWinStreak = streak[res.UserID]
		}
	}
	for _, userID := range order {
		rows[userID].CurrentStreak = streak[userID]
	}

	out := make([]LeaderboardRow, 0, len(order))
	for _, userID := range order {
		out = append(out, *rows[userID])
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Won != b.Won {
			return a.Won > b.Won
		}
		if a.WinRatePermil() != b.WinRatePermil() {
			return a.WinRatePermil() > b.WinRatePermil()
		}
		if a.Played != b.Played {
			return a.Played > b.Played
		}
		return a.UserID < b.UserID
	})
	return out
}
