package domain

import "testing"

func TestLeaderboardOf_WinLossAndRanking(t *testing.T) {
	results := []PlayerGameResult{
		{UserID: "a", PlayedOn: "2026-08-01", Side: SideA, WinnerSide: SideA}, // a menang
		{UserID: "b", PlayedOn: "2026-08-01", Side: SideB, WinnerSide: SideA}, // b kalah
		{UserID: "a", PlayedOn: "2026-08-02", Side: SideA, WinnerSide: SideA}, // a menang lagi
		{UserID: "b", PlayedOn: "2026-08-02", Side: SideB, WinnerSide: SideA}, // b kalah lagi
		{UserID: "b", PlayedOn: "2026-08-03", Side: SideA, WinnerSide: SideA}, // b menang (sisi beda)
	}
	rows := LeaderboardOf(results)
	if len(rows) != 2 {
		t.Fatalf("baris = %d, mau 2", len(rows))
	}
	// a: 2 main, 2 menang, di atas b (1 menang dari 3 main).
	if rows[0].UserID != "a" || rows[0].Won != 2 || rows[0].Played != 2 {
		t.Fatalf("baris teratas salah: %+v", rows[0])
	}
	if rows[0].CurrentStreak != 2 || rows[0].LongestWinStreak != 2 {
		t.Fatalf("streak a salah: current=%d longest=%d", rows[0].CurrentStreak, rows[0].LongestWinStreak)
	}
	b := rows[1]
	if b.UserID != "b" || b.Played != 3 || b.Won != 1 || b.Lost != 2 {
		t.Fatalf("baris b salah: %+v", b)
	}
	// b: kalah, kalah, menang -> current streak +1 (baru menang sekali).
	if b.CurrentStreak != 1 {
		t.Fatalf("current streak b = %d, mau 1", b.CurrentStreak)
	}
}

func TestLeaderboardOf_LosingStreakIsNegative(t *testing.T) {
	results := []PlayerGameResult{
		{UserID: "x", PlayedOn: "2026-08-01", Side: SideA, WinnerSide: SideB},
		{UserID: "x", PlayedOn: "2026-08-02", Side: SideA, WinnerSide: SideB},
		{UserID: "x", PlayedOn: "2026-08-03", Side: SideA, WinnerSide: SideB},
	}
	rows := LeaderboardOf(results)
	if rows[0].CurrentStreak != -3 {
		t.Fatalf("current streak = %d, mau -3", rows[0].CurrentStreak)
	}
	if rows[0].LongestWinStreak != 0 {
		t.Fatalf("longest win streak = %d, mau 0 (belum pernah menang)", rows[0].LongestWinStreak)
	}
}

func TestLeaderboardOf_SkipsGamesWithoutWinner(t *testing.T) {
	results := []PlayerGameResult{
		{UserID: "a", PlayedOn: "2026-08-01", Side: SideA, WinnerSide: SideNil},
	}
	rows := LeaderboardOf(results)
	if len(rows) != 0 {
		t.Fatalf("baris = %d, mau 0 (main tanpa skor tidak boleh kehitung)", len(rows))
	}
}

func TestLeaderboardOf_WinRatePermil(t *testing.T) {
	row := LeaderboardRow{Played: 3, Won: 2}
	if row.WinRatePermil() != 666 {
		t.Fatalf("win rate = %d, mau 666", row.WinRatePermil())
	}
	empty := LeaderboardRow{}
	if empty.WinRatePermil() != 0 {
		t.Fatalf("win rate main kosong = %d, mau 0", empty.WinRatePermil())
	}
}
