package domain

import "testing"

func kok(price int64) Kok { return Kok{ID: "k", Price: price} }

func fourPlayers(paid ...bool) []Player {
	names := []string{"A", "B", "C", "D"}
	out := make([]Player, len(names))
	for i, n := range names {
		p := false
		if i < len(paid) {
			p = paid[i]
		}
		out[i] = Player{Name: n, Paid: p}
	}
	return out
}

func TestGameCostOf_DibagiRataTanpaSisa(t *testing.T) {
	// 4 kok @3000 = 12000 total, 4 pemain → pas 3000/orang, tanpa pembulatan.
	cost := GameCostOf([]Kok{kok(3000 * 4)}, 4)
	if cost.PerPerson != 3000 || cost.Total != 12000 || cost.Rounding != 0 || cost.KokCount != 1 {
		t.Fatalf("got %+v", cost)
	}
}

func TestGameCostOf_DibulatkanKeAtasKeRatusan(t *testing.T) {
	// PLAN.md §9.5 A: 10.000 dibagi 3 → 3.333,33 → Rp 3.400/orang, sisa 200 ke kas.
	cost := GameCostOf([]Kok{kok(10_000)}, 3)
	if cost.PerPerson != 3400 {
		t.Fatalf("PerPerson = %d, mau 3400", cost.PerPerson)
	}
	if cost.Rounding != 200 {
		t.Fatalf("Rounding = %d, mau 200", cost.Rounding)
	}
}

func TestGameCostOf_JumlahPemainVariabel(t *testing.T) {
	// Single (2 pemain) dan rotasi (6 pemain) harus tetap benar, bukan asumsi 4.
	single := GameCostOf([]Kok{kok(6000)}, 2)
	if single.PerPerson != 3000 {
		t.Fatalf("single PerPerson = %d, mau 3000", single.PerPerson)
	}
	rotasi := GameCostOf([]Kok{kok(18_000)}, 6)
	if rotasi.PerPerson != 3000 {
		t.Fatalf("rotasi PerPerson = %d, mau 3000", rotasi.PerPerson)
	}
}

func TestGameCostOf_TanpaKok(t *testing.T) {
	cost := GameCostOf(nil, 4)
	if cost != (GameCost{PerPerson: 0, Total: 0, PlayerCount: 4, KokCount: 0, Rounding: 0}) {
		t.Fatalf("got %+v", cost)
	}
}

func TestEnrichGame_RingkasanBayar(t *testing.T) {
	g := StoredGame{
		ID:      "g1",
		Koks:    []Kok{kok(12_000)},
		Players: fourPlayers(true, false, false, false),
	}
	e := EnrichGame(g)
	if e.Cost.PerPerson != 3000 {
		t.Fatalf("PerPerson = %d, mau 3000", e.Cost.PerPerson)
	}
	for _, p := range e.Players {
		if p.Amount != 3000 {
			t.Fatalf("player amount = %d, mau 3000", p.Amount)
		}
	}
	if e.Summary.PaidCount != 1 || e.Summary.UnpaidCount != 3 {
		t.Fatalf("summary count salah: %+v", e.Summary)
	}
	if e.Summary.PaidTotal != 3000 || e.Summary.UnpaidTotal != 9000 {
		t.Fatalf("summary total salah: %+v", e.Summary)
	}
	if e.Summary.AllPaid {
		t.Fatal("AllPaid harusnya false")
	}
}

func TestGameMatchNumbers_UrutCreatedAtBukanInput(t *testing.T) {
	games := []StoredGame{
		{ID: "g1", Date: "2026-01-01", CreatedAt: "2026-01-01T09:30:00.000Z"},
		{ID: "g2", Date: "2026-01-01", CreatedAt: "2026-01-01T08:00:00.000Z"},
	}
	nums := GameMatchNumbers(games)
	if nums["g2"] != 1 || nums["g1"] != 2 {
		t.Fatalf("got %+v", nums)
	}
}
