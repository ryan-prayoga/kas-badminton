package domain

import "testing"

func tkok(price int64, matchID string) TournamentKok {
	return TournamentKok{Kok: Kok{Price: price}, MatchID: matchID, Date: "2026-03-01"}
}

func sc(a, b int) MatchScore {
	return MatchScore{Format: ScoreSingle, Games: []GameScore{{A: a, B: b}}}
}

func bo3(games ...[2]int) MatchScore {
	gs := make([]GameScore, len(games))
	for i, g := range games {
		gs[i] = GameScore{A: g[0], B: g[1]}
	}
	return MatchScore{Format: ScoreBo3, Games: gs}
}

// tour builds a StoredTournament with pairs "A0/B0".."An/Bn" by default.
func tour(size int, mutate func(*TournamentDraft)) StoredTournament {
	pairs := make([]TournamentPair, size)
	for i := range pairs {
		pairs[i] = TournamentPair{ID: idFor(i), Slot: i, A: letterName("A", i), B: letterName("B", i)}
	}
	d := TournamentDraft{
		ID: "t1", Name: "Tarkam", Date: "2026-03-01", Size: size,
		Pairs: pairs, CreatedAt: "2026-03-01T00:00:00.000Z", UpdatedAt: "2026-03-01T00:00:00.000Z",
	}
	if mutate != nil {
		mutate(&d)
	}
	return NormalizeStoredTournament(d, nil)
}

func idFor(slot int) string                  { return "p" + itoaSmall(slot) }
func letterName(prefix string, i int) string { return prefix + itoaSmall(i) }

func itoaSmall(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

func TestPairLabelParticipantNames(t *testing.T) {
	if got := PairLabel(&TournamentPair{A: "Fahri", B: "Alan"}); got != "Fahri / Alan" {
		t.Fatalf("got %q", got)
	}
	if got := PairLabel(&TournamentPair{A: "Fahri"}); got != "Fahri" {
		t.Fatalf("got %q", got)
	}
	if got := PairLabel(&TournamentPair{}); got != "" {
		t.Fatalf("got %q", got)
	}
	names := ParticipantNames([]TournamentPair{
		{ID: "p0", Slot: 0, A: "Roni", B: "Yahya"},
		{ID: "p1", Slot: 1, A: "roni", B: "Dika"},
	})
	want := []string{"Roni", "Yahya", "Dika"}
	if len(names) != len(want) {
		t.Fatalf("got %v", names)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("got %v, mau %v", names, want)
		}
	}
}

func TestNormalizeStoredTournament(t *testing.T) {
	tt := tour(8, func(d *TournamentDraft) {
		d.Pairs = []TournamentPair{{ID: "p0", Slot: 0, A: "A", B: "B"}}
	})
	if len(tt.Pairs) != 8 {
		t.Fatalf("len pairs = %d, mau 8", len(tt.Pairs))
	}
	if tt.Pairs[7].Slot != 7 || tt.Pairs[7].A != "" || tt.Pairs[7].B != "" {
		t.Fatalf("slot 7 = %+v", tt.Pairs[7])
	}

	if got := NormalizeSize(99); got != 32 {
		t.Fatalf("size 99 = %d, mau 32", got)
	}
	if got := NormalizeSize(0); got != 2 {
		t.Fatalf("size 0 = %d, mau 2", got)
	}
	if got := NormalizeSize(7); got != 7 {
		t.Fatalf("size 7 = %d, mau 7", got)
	}

	skor0 := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": sc(0, 0), "r0-1": sc(21, 15)}
	})
	if _, ok := skor0.Results["r0-0"]; ok {
		t.Fatal("skor 0-0 harusnya dianggap belum dimainkan")
	}
	if skor0.Results["r0-1"].Games[0] != (GameScore{A: 21, B: 15}) {
		t.Fatalf("got %+v", skor0.Results["r0-1"])
	}
}

func TestRoundLabel(t *testing.T) {
	cases := []struct {
		round, total int
		want         string
	}{
		{3, 4, "Final"}, {2, 4, "Semifinal"}, {1, 4, "Perempat Final"},
		{0, 4, "Babak 16 Besar"}, {0, 2, "Semifinal"},
	}
	for _, c := range cases {
		if got := RoundLabel(c.round, c.total); got != c.want {
			t.Errorf("RoundLabel(%d,%d) = %q, mau %q", c.round, c.total, got, c.want)
		}
	}
}

func TestBuildBracket_EmpatPasangan(t *testing.T) {
	b := BuildBracket(tour(4, nil))
	if len(b.Rounds) != 2 || len(b.Rounds[0].Matches) != 2 || len(b.Rounds[1].Matches) != 1 {
		t.Fatalf("got %d rounds", len(b.Rounds))
	}
	if b.Rounds[0].Label != "Semifinal" || b.Rounds[1].Label != "Final" {
		t.Fatalf("labels: %q %q", b.Rounds[0].Label, b.Rounds[1].Label)
	}
	if b.Champion != nil {
		t.Fatal("champion harusnya nil")
	}
}

func TestBuildBracket_SkorMenentukanPemenang(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": sc(21, 12), "r0-1": sc(15, 21)}
	})
	b := BuildBracket(tt)
	if b.Rounds[0].Matches[0].Winner != SideA {
		t.Fatal("winner harusnya a")
	}
	if b.Rounds[1].Matches[0].A.Pair.ID != "p0" || b.Rounds[1].Matches[0].B.Pair.ID != "p3" {
		t.Fatalf("final slots salah: %+v", b.Rounds[1].Matches[0])
	}
	if b.Champion != nil {
		t.Fatal("final belum dimainkan, champion harusnya nil")
	}
}

func TestBuildBracket_ByeLolosOtomatis(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "Fahri", B: "Alan"},
			{ID: "p1", Slot: 1},
			{ID: "p2", Slot: 2, A: "Andre", B: "Enyok"},
			{ID: "p3", Slot: 3, A: "Wuri", B: "Sakha"},
		}
	})
	b := BuildBracket(tt)
	m := b.Rounds[0].Matches[0]
	if !m.B.Bye || m.Winner != SideA || !m.AutoWin {
		t.Fatalf("got %+v", m)
	}
	if b.Rounds[1].Matches[0].A.Pair.ID != "p0" {
		t.Fatalf("got %+v", b.Rounds[1].Matches[0].A.Pair)
	}
}

func TestBuildBracket_SeriTidakMeloloskan(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) { d.Results = map[string]MatchScore{"r0-0": sc(21, 21)} })
	if BuildBracket(tt).Rounds[0].Matches[0].Winner != SideNil {
		t.Fatal("skor seri harusnya tanpa winner")
	}
}

func TestBuildBracket_JuaraSetelahFinal(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": sc(21, 12), "r0-1": sc(21, 9), "r1-0": sc(18, 21)}
	})
	b := BuildBracket(tt)
	if b.Champion == nil || b.Champion.ID != "p2" {
		t.Fatalf("champion = %+v", b.Champion)
	}
}

func TestBuildBracket_CabangByeSemuaTetapBye(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "Roni", B: "Yahya"},
			{ID: "p1", Slot: 1, A: "Dika", B: "Sandi"},
			{ID: "p2", Slot: 2},
			{ID: "p3", Slot: 3},
		}
		d.Results = map[string]MatchScore{"r0-0": sc(21, 10)}
	})
	b := BuildBracket(tt)
	if !b.Rounds[1].Matches[0].B.Bye {
		t.Fatal("babak 2 sisi B harusnya BYE")
	}
	if b.Champion == nil || b.Champion.ID != "p0" {
		t.Fatalf("champion = %+v", b.Champion)
	}
}

func TestBuildBracket_16Pasangan(t *testing.T) {
	b := BuildBracket(tour(16, nil))
	want := []int{8, 4, 2, 1}
	for i, r := range b.Rounds {
		if len(r.Matches) != want[i] {
			t.Fatalf("round %d = %d matches, mau %d", i, len(r.Matches), want[i])
		}
	}
}

func TestBracketSize(t *testing.T) {
	cases := map[int]int{14: 16, 8: 8, 5: 8, 2: 2}
	for in, want := range cases {
		if got := BracketSize(in); got != want {
			t.Errorf("BracketSize(%d) = %d, mau %d", in, got, want)
		}
	}
}

func TestEnamPasangan_ByeDisebar(t *testing.T) {
	et := EnrichTournament(tour(6, nil))
	want := []int{4, 2, 1}
	for i, r := range et.Bracket.Rounds {
		if len(r.Matches) != want[i] {
			t.Fatalf("round %d = %d, mau %d", i, len(r.Matches), want[i])
		}
	}
	first := et.Bracket.Rounds[0].Matches
	autoWins, bothBye := 0, 0
	for _, m := range first {
		if m.AutoWin {
			autoWins++
		}
		if m.A.Bye && m.B.Bye {
			bothBye++
		}
	}
	if autoWins != 2 {
		t.Fatalf("autoWins = %d, mau 2", autoWins)
	}
	if bothBye != 0 {
		t.Fatalf("bothBye = %d, mau 0", bothBye)
	}
	if et.TotalCount != 5 {
		t.Fatalf("TotalCount = %d, mau 5", et.TotalCount)
	}
}

func TestRoundRobinMatchCount(t *testing.T) {
	if RoundRobinMatchCount(4) != 6 {
		t.Fatal("4 pasangan harusnya 6 partai")
	}
	if RoundRobinMatchCount(3) != 3 {
		t.Fatal("3 pasangan harusnya 3 partai")
	}
}

func rr(size int, mutate func(*TournamentDraft)) EnrichedTournament {
	return EnrichTournament(tour(size, func(d *TournamentDraft) {
		d.Format = FormatRoundRobin
		if mutate != nil {
			mutate(d)
		}
	}))
}

func TestRoundRobin_SemuaLawanSemua(t *testing.T) {
	tt := rr(3, nil)
	if tt.Bracket != nil {
		t.Fatal("bracket harusnya nil di round robin")
	}
	want := []string{"rr0-1", "rr0-2", "rr1-2"}
	if len(tt.Matches) != len(want) {
		t.Fatalf("got %d matches", len(tt.Matches))
	}
	for i, id := range want {
		if tt.Matches[i].ID != id {
			t.Fatalf("match %d id = %q, mau %q", i, tt.Matches[i].ID, id)
		}
	}
	if tt.TotalCount != 3 {
		t.Fatalf("TotalCount = %d, mau 3", tt.TotalCount)
	}
}

func TestRoundRobin_Klasemen(t *testing.T) {
	tt := rr(3, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{
			"rr0-1": sc(21, 10),
			"rr0-2": sc(21, 19),
			"rr1-2": sc(15, 21),
		}
	})
	s := tt.RoundRobin.Standings
	if s[0].Pair.ID != "p0" || s[0].Won != 2 {
		t.Fatalf("s[0] = %+v", s[0])
	}
	if s[1].Pair.ID != "p2" {
		t.Fatalf("s[1] = %+v", s[1])
	}
	if tt.Champion == nil || tt.Champion.ID != "p0" {
		t.Fatalf("champion = %+v", tt.Champion)
	}
	if !tt.Finished {
		t.Fatal("harusnya finished")
	}
}

func TestRoundRobin_JuaraKosongSelamaBelumSelesai(t *testing.T) {
	tt := rr(3, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"rr0-1": sc(21, 10)}
	})
	if tt.Champion != nil {
		t.Fatal("champion harusnya nil")
	}
	if tt.PlayedCount != 1 || tt.Finished {
		t.Fatalf("PlayedCount=%d Finished=%v", tt.PlayedCount, tt.Finished)
	}
}

func TestRoundRobin_SeriDiPuncak(t *testing.T) {
	tt := rr(3, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"rr0-1": sc(21, 10), "rr1-2": sc(21, 10), "rr0-2": sc(10, 21)}
	})
	for _, row := range tt.RoundRobin.Standings {
		if row.Won != 1 {
			t.Fatalf("semua harusnya 1 menang, dapat %+v", row)
		}
	}
	if tt.Champion != nil {
		t.Fatal("champion harusnya nil kalau seri di puncak")
	}
}

func TestRoundRobin_SlotKosongTidakMasukKlasemen(t *testing.T) {
	tt := EnrichTournament(tour(3, func(d *TournamentDraft) {
		d.Format = FormatRoundRobin
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "A", B: "B"},
			{ID: "p1", Slot: 1, A: "C", B: "D"},
			{ID: "p2", Slot: 2},
		}
	}))
	if len(tt.RoundRobin.Standings) != 2 {
		t.Fatalf("got %d standings", len(tt.RoundRobin.Standings))
	}
	if tt.TotalCount != 1 {
		t.Fatalf("TotalCount = %d, mau 1", tt.TotalCount)
	}
}

func TestRoundRobin_IdDiLuarFormatDibuang(t *testing.T) {
	tt := rr(3, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": sc(21, 10)}
	})
	if len(tt.Results) != 0 {
		t.Fatalf("results harusnya kosong, dapat %+v", tt.Results)
	}
}

func TestTournamentStatus(t *testing.T) {
	if TournamentStatus("2026-09-01", false, "2026-08-05") != StatusAkanDatang {
		t.Fatal("harusnya akan-datang")
	}
	if TournamentStatus("2026-08-05", false, "2026-08-05") != StatusBerjalan {
		t.Fatal("harusnya berjalan")
	}
	if TournamentStatus("2026-09-01", true, "2026-08-05") != StatusSelesai {
		t.Fatal("harusnya selesai")
	}
}

func TestSyncFees(t *testing.T) {
	pairs := []TournamentPair{
		{ID: "p0", Slot: 0, A: "Roni", B: "Yahya"},
		{ID: "p1", Slot: 1, A: "Dika"},
	}
	fees := SyncFees(pairs, []TournamentFee{
		{Name: "Roni", Paid: true, PaidAt: "2026-03-01T10:00:00.000Z", PaidBy: "Admin"},
		{Name: "Hilang", Paid: true},
	})
	want := []string{"Roni", "Yahya", "Dika"}
	if len(fees) != 3 {
		t.Fatalf("got %d fees", len(fees))
	}
	for i, name := range want {
		if fees[i].Name != name {
			t.Fatalf("fees[%d] = %q, mau %q", i, fees[i].Name, name)
		}
	}
	if !fees[0].Paid || fees[0].PaidBy != "Admin" {
		t.Fatalf("fees[0] = %+v", fees[0])
	}
	if fees[1].Paid {
		t.Fatal("Yahya harusnya belum bayar")
	}
}

func TestTournamentCost(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "A", B: "B"},
			{ID: "p1", Slot: 1, A: "C", B: "D"},
			{ID: "p2", Slot: 2},
			{ID: "p3", Slot: 3},
		}
		d.Fee = 5000
		d.Koks = []TournamentKok{tkok(3000, ""), tkok(3000, "")}
	})
	cost := TournamentCostOf(tt)
	if cost.KokCount != 2 {
		t.Fatalf("KokCount = %d, mau 2", cost.KokCount)
	}
	if cost.KokTotal != 6000 {
		t.Fatalf("KokTotal = %d, mau 6000", cost.KokTotal)
	}
	if cost.Participants != 4 {
		t.Fatalf("Participants = %d, mau 4", cost.Participants)
	}
	if cost.FeeTotal != 20_000 || cost.FeeUnpaid != 20_000 {
		t.Fatalf("FeeTotal=%d FeeUnpaid=%d", cost.FeeTotal, cost.FeeUnpaid)
	}
}

func TestSuggestFee(t *testing.T) {
	cases := []struct {
		total        int64
		participants int
		want         int64
	}{
		{24_000, 4, 6000}, {25_000, 4, 6500}, {0, 4, 0}, {24_000, 0, 0},
	}
	for _, c := range cases {
		if got := SuggestFee(c.total, c.participants); got != c.want {
			t.Errorf("SuggestFee(%d,%d) = %d, mau %d", c.total, c.participants, got, c.want)
		}
	}
}

func TestFormatSkor_Single(t *testing.T) {
	b := BuildBracket(tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": sc(30, 28)}
	}))
	m := b.Rounds[0].Matches[0]
	if m.Winner != SideA || m.GamesWon != (GamesWonCount{A: 1, B: 0}) {
		t.Fatalf("got %+v", m)
	}
}

func TestFormatSkor_Bo3(t *testing.T) {
	satu := BuildBracket(tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": bo3([2]int{21, 15})}
	}))
	if satu.Rounds[0].Matches[0].Winner != SideNil {
		t.Fatal("1 game menang belum cukup buat bo3")
	}
	dua := BuildBracket(tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": bo3([2]int{21, 15}, [2]int{21, 19})}
	}))
	if dua.Rounds[0].Matches[0].Winner != SideA {
		t.Fatal("2 game menang harusnya cukup")
	}
}

func TestFormatSkor_Bo3KalahDuluMenangKemudian(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": bo3([2]int{15, 21}, [2]int{21, 18}, [2]int{21, 19})}
	})
	m := BuildBracket(tt).Rounds[0].Matches[0]
	if m.GamesWon != (GamesWonCount{A: 2, B: 1}) || m.Winner != SideA {
		t.Fatalf("got %+v", m)
	}
}

func TestFormatSkor_Bo3SatuSatuBelumAdaPemenang(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{"r0-0": bo3([2]int{21, 15}, [2]int{18, 21})}
	})
	if BuildBracket(tt).Rounds[0].Matches[0].Winner != SideNil {
		t.Fatal("1-1 belum ada pemenang")
	}
}

func TestFormatSkor_GameDibuangDanDipotong(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{
			"r0-0": bo3([2]int{21, 15}, [2]int{0, 0}, [2]int{21, 19}),
			"r0-1": {Format: ScoreSingle, Games: []GameScore{{A: 30, B: 20}, {A: 21, B: 5}}},
		}
	})
	if len(tt.Results["r0-0"].Games) != 2 {
		t.Fatalf("got %d games", len(tt.Results["r0-0"].Games))
	}
	if len(tt.Results["r0-1"].Games) != 1 {
		t.Fatalf("got %d games", len(tt.Results["r0-1"].Games))
	}
}

func TestScoreLine(t *testing.T) {
	if got := ScoreLine(&MatchScore{Games: []GameScore{{21, 18}, {19, 21}, {21, 15}}}); got != "21-18 · 19-21 · 21-15" {
		t.Fatalf("got %q", got)
	}
	if got := ScoreLine(nil); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestFormatTurnamenDinormalisasi(t *testing.T) {
	if tour(2, nil).ScoreFormat != ScoreSingle {
		t.Fatal("default harusnya single")
	}
	if tour(2, func(d *TournamentDraft) { d.ScoreFormat = ScoreBo3 }).ScoreFormat != ScoreBo3 {
		t.Fatal("harusnya bo3")
	}
	if MaxGames(ScoreBo3) != 3 || MaxGames(ScoreSingle) != 1 {
		t.Fatal("MaxGames salah")
	}
}

func TestTurnamenLebihDariSehari(t *testing.T) {
	if got := tour(2, func(d *TournamentDraft) { d.Date = "2026-08-04"; d.EndDate = "2026-08-06" }).EndDate; got != "2026-08-06" {
		t.Fatalf("EndDate = %q", got)
	}
	if got := tour(2, func(d *TournamentDraft) { d.Date = "2026-08-04"; d.EndDate = "2026-08-04" }).EndDate; got != "" {
		t.Fatalf("EndDate = %q, mau kosong", got)
	}
	if got := tour(2, func(d *TournamentDraft) { d.Date = "2026-08-04"; d.EndDate = "2026-08-01" }).EndDate; got != "" {
		t.Fatalf("EndDate = %q, mau kosong", got)
	}
}

func TestKokPerPartai(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Koks = []TournamentKok{tkok(3000, "r0-0"), tkok(5000, "r0-0"), tkok(4000, "r1-0"), tkok(3000, "")}
	})
	b := BuildBracket(tt)
	semi := b.Rounds[0].Matches[0]
	if len(semi.Koks) != 2 {
		t.Fatalf("got %d koks", len(semi.Koks))
	}
	if semi.KokTotal != 8000 {
		t.Fatalf("KokTotal = %d, mau 8000", semi.KokTotal)
	}
	if len(b.Rounds[1].Matches[0].Koks) != 1 {
		t.Fatal("final harusnya 1 kok")
	}
	if len(b.Rounds[0].Matches[1].Koks) != 0 {
		t.Fatal("semi kedua harusnya tanpa kok")
	}

	cost := TournamentCostOf(tt)
	if cost.KokCount != 4 || cost.KokTotal != 15_000 || len(cost.LooseKoks) != 1 {
		t.Fatalf("cost = %+v", cost)
	}
}

func TestMatchIdDiLuarBaganJadiKokUmum(t *testing.T) {
	tt := tour(4, func(d *TournamentDraft) {
		d.Koks = []TournamentKok{tkok(3000, "r9-9"), tkok(3000, "bukan-id")}
	})
	for _, k := range tt.Koks {
		if k.MatchID != "" {
			t.Fatalf("MatchID = %q, mau kosong", k.MatchID)
		}
	}
	if TournamentCostOf(tt).KokCount != 2 {
		t.Fatal("kok harusnya tetap kehitung, cuma jadi umum")
	}
}

func TestKoksByMatch(t *testing.T) {
	m := KoksByMatch([]TournamentKok{tkok(3000, "r0-0"), tkok(3000, ""), tkok(3000, "r0-0")})
	if len(m["r0-0"]) != 2 || len(m[""]) != 1 {
		t.Fatalf("got %+v", m)
	}
}

func TestTanggalKokDijepitKeRentang(t *testing.T) {
	tt := tour(2, func(d *TournamentDraft) {
		d.Date = "2026-08-04"
		d.EndDate = "2026-08-06"
		d.Koks = []TournamentKok{
			{Kok: Kok{Price: 3000}, Date: "2026-08-05"},
			{Kok: Kok{Price: 3000}, Date: "2026-08-01"},
			{Kok: Kok{Price: 3000}, Date: "2026-09-01"},
			{Kok: Kok{Price: 3000}, Date: "bukan-tanggal"},
		}
	})
	want := []string{"2026-08-05", "2026-08-04", "2026-08-06", "2026-08-04"}
	for i, w := range want {
		if tt.Koks[i].Date != w {
			t.Fatalf("koks[%d].Date = %q, mau %q", i, tt.Koks[i].Date, w)
		}
	}
}

func TestKoksByDate(t *testing.T) {
	groups := KoksByDate([]TournamentKok{
		{Kok: Kok{Price: 3000}, Date: "2026-08-06"},
		{Kok: Kok{Price: 3000}, Date: "2026-08-04"},
		{Kok: Kok{Price: 3000}, Date: "2026-08-06"},
	})
	if len(groups) != 2 || groups[0].Date != "2026-08-04" || len(groups[1].Koks) != 2 {
		t.Fatalf("got %+v", groups)
	}
}

func TestTournamentDays(t *testing.T) {
	days := TournamentDays("2026-08-04", "2026-08-06")
	want := []string{"2026-08-04", "2026-08-05", "2026-08-06"}
	if len(days) != len(want) {
		t.Fatalf("got %v", days)
	}
	for i := range want {
		if days[i] != want[i] {
			t.Fatalf("got %v, mau %v", days, want)
		}
	}
	if got := TournamentDays("2026-08-04", ""); len(got) != 1 || got[0] != "2026-08-04" {
		t.Fatalf("got %v", got)
	}
}

func TestMatchTitle(t *testing.T) {
	if got := MatchTitle(FormatKnockout, 8, 0, 1); got != "Perempat Final · Partai 2" {
		t.Fatalf("got %q", got)
	}
	if got := MatchTitle(FormatKnockout, 8, 2, 0); got != "Final" {
		t.Fatalf("got %q", got)
	}
	if got := MatchTitle(FormatRoundRobin, 4, 0, 2); got != "Partai 3" {
		t.Fatalf("got %q", got)
	}
}

func TestTournamentPodium_BelumSelesai(t *testing.T) {
	tt := EnrichTournament(tour(4, nil))
	p := TournamentPodiumOf(tt)
	if p.Champion != nil || p.RunnerUp != nil || len(p.Third) != 0 {
		t.Fatalf("got %+v", p)
	}
}

func TestTournamentPodium_Knockout(t *testing.T) {
	tt := EnrichTournament(tour(4, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{
			"r0-0": sc(30, 20),
			"r0-1": sc(30, 10),
			"r1-0": sc(30, 25),
		}
	}))
	p := TournamentPodiumOf(tt)
	if PairLabel(p.Champion) != "A0 / B0" {
		t.Fatalf("champion = %q", PairLabel(p.Champion))
	}
	if PairLabel(p.RunnerUp) != "A2 / B2" {
		t.Fatalf("runnerUp = %q", PairLabel(p.RunnerUp))
	}
	if len(p.Third) != 2 {
		t.Fatalf("third = %+v", p.Third)
	}
}

func TestTournamentPodium_RoundRobin(t *testing.T) {
	tt := rr(3, func(d *TournamentDraft) {
		d.Results = map[string]MatchScore{
			"rr0-1": sc(30, 20),
			"rr0-2": sc(30, 10),
			"rr1-2": sc(30, 15),
		}
	})
	p := TournamentPodiumOf(tt)
	if PairLabel(p.Champion) != "A0 / B0" {
		t.Fatalf("champion = %q", PairLabel(p.Champion))
	}
	if PairLabel(p.RunnerUp) != "A1 / B1" {
		t.Fatalf("runnerUp = %q", PairLabel(p.RunnerUp))
	}
	if len(p.Third) != 1 || PairLabel(&p.Third[0]) != "A2 / B2" {
		t.Fatalf("third = %+v", p.Third)
	}
}
