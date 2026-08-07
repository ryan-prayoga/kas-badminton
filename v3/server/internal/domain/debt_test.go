package domain

import "testing"

func dgame(id string, koks []Kok, players []Player) StoredGame {
	return StoredGame{ID: id, Date: "2026-01-01", Koks: koks, Players: players,
		CreatedAt: "2026-01-01T00:00:00.000Z", UpdatedAt: "2026-01-01T00:00:00.000Z"}
}

func unpaid(names ...string) []Player {
	out := make([]Player, len(names))
	for i, n := range names {
		out[i] = Player{Name: n, Paid: false}
	}
	return out
}

func TestBuildDebtSummary_AkumulasiCarryUrut(t *testing.T) {
	games := []EnrichedGame{
		EnrichGame(dgame("g1", []Kok{kok(12_000)}, []Player{
			{Name: "A"}, {Name: "B"}, {Name: "C", Paid: true}, {Name: "D"},
		})),
		EnrichGame(dgame("g2", []Kok{kok(24_000)}, unpaid("A", "X", "Y", "Z"))),
	}
	carry := CarryMap{"A": 2000}
	debt := BuildDebtSummary(games, carry, nil)

	var a *DebtEntry
	for i := range debt {
		if debt[i].Name == "A" {
			a = &debt[i]
		}
	}
	if a == nil {
		t.Fatal("A tidak ada di debt summary")
	}
	if a.OwedGross != 3000+6000 {
		t.Fatalf("OwedGross = %d, mau 9000", a.OwedGross)
	}
	if a.Carry != 2000 || a.Total != 7000 {
		t.Fatalf("Carry=%d Total=%d", a.Carry, a.Total)
	}
	if debt[0].Total < debt[len(debt)-1].Total {
		t.Fatal("urutan harusnya total menurun")
	}
}

func TestBuildDebtSummary_MatchNumberIkutCreatedAt(t *testing.T) {
	games := []EnrichedGame{
		EnrichGame(StoredGame{ID: "g1", Date: "2026-01-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D"), CreatedAt: "2026-01-01T09:30:00.000Z"}),
		EnrichGame(StoredGame{ID: "g2", Date: "2026-01-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D"), CreatedAt: "2026-01-01T08:00:00.000Z"}),
	}
	debt := BuildDebtSummary(games, CarryMap{}, nil)
	var a *DebtEntry
	for i := range debt {
		if debt[i].Name == "A" {
			a = &debt[i]
		}
	}
	byGame := map[string]DebtItem{}
	for _, it := range a.Items {
		byGame[it.GameID] = it
	}
	if byGame["g2"].MatchNumber != 1 || byGame["g2"].CreatedAt != "2026-01-01T08:00:00.000Z" {
		t.Fatalf("g2 = %+v", byGame["g2"])
	}
	if byGame["g1"].MatchNumber != 2 {
		t.Fatalf("g1 = %+v", byGame["g1"])
	}
}

func TestPlanInstallment_GreedyOldestFirst(t *testing.T) {
	games := []StoredGame{
		{ID: "old", Date: "2026-01-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D"), CreatedAt: "2026-01-01T00:00:00.000Z"},
		{ID: "new", Date: "2026-02-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D"), CreatedAt: "2026-02-01T00:00:00.000Z"},
	}
	plan := PlanInstallment(games, CarryMap{}, "A", 4000, nil)
	if len(plan.Touched) != 1 || plan.Touched[0] != (TouchedSlot{Kind: DebtKindGame, ID: "old", Index: 0}) {
		t.Fatalf("touched = %+v", plan.Touched)
	}
	if !plan.HasCarryAfter || plan.CarryAfter != 1000 {
		t.Fatalf("carryAfter = %+v/%d", plan.HasCarryAfter, plan.CarryAfter)
	}
	if plan.PaymentAmount != 4000 || plan.ClearsDebt {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanInstallment_CarryLamaIkutJadiKredit(t *testing.T) {
	games := []StoredGame{
		{ID: "old", Date: "2026-01-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D")},
		{ID: "new", Date: "2026-02-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D")},
	}
	plan := PlanInstallment(games, CarryMap{"A": 2000}, "A", 4000, nil) // 6000 -> lunasi 2 game
	if len(plan.Touched) != 2 {
		t.Fatalf("touched = %+v", plan.Touched)
	}
	if plan.HasCarryAfter {
		t.Fatal("carryAfter harusnya kosong (lunas semua)")
	}
	if !plan.ClearsDebt {
		t.Fatal("harusnya clearsDebt")
	}
}

func TestPlanInstallment_TanpaTagihanCumaNambahTitipan(t *testing.T) {
	plan := PlanInstallment(nil, CarryMap{}, "A", 5000, nil)
	if len(plan.Touched) != 0 {
		t.Fatal("touched harusnya kosong")
	}
	if !plan.HasCarryAfter || plan.CarryAfter != 5000 {
		t.Fatalf("carryAfter = %v/%d", plan.HasCarryAfter, plan.CarryAfter)
	}
	if plan.ClearsDebt {
		t.Fatal("clearsDebt harusnya false")
	}
}

func TestPlanSettle(t *testing.T) {
	games := []StoredGame{
		{ID: "g1", Date: "2026-01-01", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D")},
		{ID: "g2", Date: "2026-01-02", Koks: []Kok{kok(12_000)}, Players: unpaid("A", "B", "C", "D")},
	}
	plan := PlanSettle(games, CarryMap{"A": 2000}, "A", nil)
	if len(plan.Touched) != 2 {
		t.Fatalf("touched = %+v", plan.Touched)
	}
	if plan.HasCarryAfter {
		t.Fatal("carryAfter harusnya kosong")
	}
	if plan.PaymentAmount != 6000-2000 {
		t.Fatalf("payment = %d", plan.PaymentAmount)
	}
}

// --- Integrasi turnamen (dari v2 tournament.test.ts) ---

func TestDebt_IuranTurnamenTidakIkutHutangKok(t *testing.T) {
	games := []EnrichedGame{EnrichGame(dgame("g1", []Kok{kok(12_000)}, unpaid("A", "X", "Y", "Z")))}
	tt := EnrichTournament(tour(4, func(d *TournamentDraft) {
		d.ID = "t1"
		d.Date = "2026-02-01"
		d.Fee = 5000
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "A", B: "X"},
			{ID: "p1", Slot: 1}, {ID: "p2", Slot: 2}, {ID: "p3", Slot: 3},
		}
	}))

	debt := BuildDebtSummary(games, CarryMap{}, []EnrichedTournament{tt})
	var a *DebtEntry
	for i := range debt {
		if debt[i].Name == "A" {
			a = &debt[i]
		}
	}
	if a.OwedGross != 3000 {
		t.Fatalf("OwedGross = %d, mau 3000 (cuma kok main)", a.OwedGross)
	}
	if len(a.Items) != 1 || a.Items[0].Kind != DebtKindGame {
		t.Fatalf("items = %+v", a.Items)
	}
}

func TestDebt_TurnamenTanpaKokPartaiTidakMenagih(t *testing.T) {
	gratis := EnrichTournament(tour(4, func(d *TournamentDraft) { d.ID = "t2"; d.Fee = 0 }))
	if debt := BuildDebtSummary(nil, CarryMap{}, []EnrichedTournament{gratis}); len(debt) != 0 {
		t.Fatalf("got %+v", debt)
	}
}

func tourWithMatchKok(matchKokPaid map[string][4]bool) StoredTournament {
	return tour(4, func(d *TournamentDraft) {
		d.ID = "t1"
		d.Date = "2026-02-01"
		d.Fee = 0
		d.Pairs = []TournamentPair{
			{ID: "p0", Slot: 0, A: "Iskandar", B: "Arta"},
			{ID: "p1", Slot: 1, A: "Yoga", B: "Faiz"},
			{ID: "p2", Slot: 2, A: "Bidoel", B: "Deni"},
			{ID: "p3", Slot: 3, A: "Elvin", B: "Galih"},
		}
		d.Koks = []TournamentKok{tkok(2500*4, "r0-0")}
		d.MatchKokPaid = matchKokPaid
	})
}

func TestDebt_KokPerPartaiCumaEmpatPemainItu(t *testing.T) {
	tt := EnrichTournament(tourWithMatchKok(nil))
	debt := BuildDebtSummary(nil, CarryMap{}, []EnrichedTournament{tt})
	names := map[string]bool{}
	for _, d := range debt {
		names[d.Name] = true
	}
	for _, want := range []string{"Iskandar", "Arta", "Yoga", "Faiz"} {
		if !names[want] {
			t.Fatalf("%s harusnya ditagih, debt=%+v", want, debt)
		}
	}
	for _, notWant := range []string{"Bidoel", "Deni", "Elvin", "Galih"} {
		if names[notWant] {
			t.Fatalf("%s tidak main di partai berkok, harusnya tidak ditagih", notWant)
		}
	}
}

func TestDebt_YangSudahLunasHilangDariRekap(t *testing.T) {
	tt := EnrichTournament(tourWithMatchKok(map[string][4]bool{"r0-0": {true, false, false, false}}))
	debt := BuildDebtSummary(nil, CarryMap{}, []EnrichedTournament{tt})
	for _, d := range debt {
		if d.Name == "Iskandar" {
			t.Fatal("Iskandar sudah lunas, harusnya tidak muncul")
		}
	}
	if len(debt) != 3 {
		t.Fatalf("got %d entries, mau 3", len(debt))
	}
}

func TestDebt_LunasinSemuaNutupKokPartai(t *testing.T) {
	plan := PlanSettle(nil, CarryMap{}, "Iskandar", []StoredTournament{tourWithMatchKok(nil)})
	want := TouchedSlot{Kind: DebtKindTurnamenKok, ID: "t1", Index: 0, MatchID: "r0-0"}
	if len(plan.Touched) != 1 || plan.Touched[0] != want {
		t.Fatalf("touched = %+v", plan.Touched)
	}
	if plan.PaymentAmount != 2500 {
		t.Fatalf("payment = %d, mau 2500", plan.PaymentAmount)
	}
}

func TestDebt_CostKokPaidIkutTerhitung(t *testing.T) {
	belum := EnrichTournament(tourWithMatchKok(nil))
	if belum.Cost.KokPaid != 0 {
		t.Fatalf("kokPaid = %d, mau 0", belum.Cost.KokPaid)
	}
	separuh := EnrichTournament(tourWithMatchKok(map[string][4]bool{"r0-0": {true, true, false, false}}))
	if separuh.Cost.KokPaid != 5000 {
		t.Fatalf("kokPaid = %d, mau 5000", separuh.Cost.KokPaid)
	}
	semua := EnrichTournament(tourWithMatchKok(map[string][4]bool{"r0-0": {true, true, true, true}}))
	if semua.Cost.KokPaid != 10_000 || semua.Cost.KokPaid != semua.Cost.KokTotal {
		t.Fatalf("kokPaid = %d, kokTotal = %d", semua.Cost.KokPaid, semua.Cost.KokTotal)
	}
}
