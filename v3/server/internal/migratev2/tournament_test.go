package migratev2

import (
	"context"
	"testing"
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func knockoutTournamentMapping() NameMapping {
	names := []string{"Rian", "Andre", "Bagus", "Tio", "Cahyo", "Dedi", "Eko", "Faiz"}
	m := NameMapping{}
	for _, n := range names {
		m[n] = n
	}
	return m
}

// knockoutFixture — 4 pasangan, dua partai babak pertama SUDAH berskor
// (r0-0, r0-1), final (r1-0) BELUM — persis bentuk data seed lokal
// (kok_badminton dev DB) yang dipakai smoke test manual F10. Satu kok
// terikat partai (r0-0, cuma Rian yang lunas), satu kok UMUM (matchId
// null — v2 tidak pernah menagih ini, migrasi yang menutupnya).
func knockoutFixture() V2Tournament {
	return V2Tournament{
		ID: "tour1", Name: "Turnamen Tes", Date: "2026-08-05", Size: 4, Format: "knockout", Fee: 5000, ScoreFormat: "single",
		Pairs: []V2Pair{
			{ID: "p0", Slot: 0, A: "Rian", B: "Andre"},
			{ID: "p1", Slot: 1, A: "Bagus", B: "Tio"},
			{ID: "p2", Slot: 2, A: "Cahyo", B: "Dedi"},
			{ID: "p3", Slot: 3, A: "Eko", B: "Faiz"},
		},
		Results: map[string]V2MatchScore{
			"r0-0": {Format: "single", Games: []V2GameScore{{A: 21, B: 15}}},
			"r0-1": {Format: "single", Games: []V2GameScore{{A: 21, B: 18}}},
		},
		Koks: []V2TournamentKok{
			{TypeID: nil, TypeName: t3ptr("Yonex AS50"), PricePerPerson: 3000, MatchID: t3ptr("r0-0"), Date: "2026-08-05"},
			{TypeID: nil, TypeName: t3ptr("Yonex AS50"), PricePerPerson: 3000, MatchID: nil, Date: "2026-08-05"}, // kok umum
		},
		Fees: []V2TournamentFee{
			{Name: "Rian", Paid: true, PaidAt: t3ptr("2026-08-05")},
			{Name: "Andre", Paid: false}, {Name: "Bagus", Paid: false}, {Name: "Tio", Paid: false},
			{Name: "Cahyo", Paid: false}, {Name: "Dedi", Paid: false}, {Name: "Eko", Paid: false}, {Name: "Faiz", Paid: false},
		},
		MatchKokPaid: map[string][4]bool{"r0-0": {true, false, false, false}},
		RecordedBy:   t3ptr("Admin"), // tidak ada di players — best-effort, tidak wajib mapping
		CreatedAt:    knockoutFixtureTime, UpdatedAt: knockoutFixtureTime,
	}
}

var knockoutFixtureTime = mustParseTime("2026-08-05T10:00:00Z")

func TestMigrate_TournamentKnockout(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := &fakeReader{
		players:     []V2Player{}, // peserta turnamen belum tentu anggota `players` v2 — mapping cukup
		tournaments: []V2Tournament{knockoutFixture()},
	}
	slug := testSlug(t)
	mapping := knockoutTournamentMapping()

	result, err := Migrate(context.Background(), fixture, s, mapping, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta", AdminName: "Rian"})
	if err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if result.TournamentsCreated != 1 {
		t.Fatalf("TournamentsCreated = %d, mau 1", result.TournamentsCreated)
	}
	// r0-0 dan r0-1 berskor, r1-0 (final) belum — playedCount = 2.
	if result.PartaiCount != 2 {
		t.Fatalf("PartaiCount = %d, mau 2 (r0-0 + r0-1, final belum berskor)", result.PartaiCount)
	}

	err = s.WithClub(context.Background(), result.ClubID, func(ctx context.Context, q *gen.Queries) error {
		tID := tournamentID(slug, "tour1")

		fees, err := q.SumTournamentFees(ctx, tID)
		if err != nil {
			return err
		}
		if fees != 40000 {
			t.Errorf("total iuran = %d, mau 40000 (8 peserta x 5000)", fees)
		}

		charges, err := q.SumMatchKokCharges(ctx, tID)
		if err != nil {
			return err
		}
		// r0-0: 3000/orang x 4 = 12000. Kok umum: total 3000*4=12000 dibagi
		// 8 peserta = 1500/orang x 8 = 12000 (pas, tanpa pembulatan).
		// Total = 24000.
		if charges != 24000 {
			t.Errorf("total tagihan kok = %d, mau 24000", charges)
		}

		rianID := userID(slug, "Rian")
		bal, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: result.ClubID, UserID: rianID})
		_ = bal // dompet tidak relevan di sini, cuma memastikan Rian sungguhan jadi user
		if err != nil {
			return err
		}
		m, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: result.ClubID, UserID: rianID})
		if err != nil {
			return err
		}
		if m.Role != gen.ClubRoleAdmin {
			t.Errorf("role Rian = %s, mau admin (--admin)", m.Role)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi: %v", err)
	}

	// Idempoten.
	result2, err := Migrate(context.Background(), fixture, s, mapping, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta", AdminName: "Rian"})
	if err != nil {
		t.Fatalf("Migrate kedua: %v", err)
	}
	if result2.PartaiCount != 2 || result2.TournamentsCreated != 1 {
		t.Fatalf("hasil migrasi kedua beda: %+v vs %+v", result2, result)
	}
}

func TestMigrate_TournamentLooseKokRoundingGoesToExpense(t *testing.T) {
	s := store.New(testdb.Pool(t))
	tour := V2Tournament{
		ID: "tour2", Name: "Turnamen Ganjil", Date: "2026-08-05", Size: 2, Format: "knockout", Fee: 0, ScoreFormat: "single",
		// 3 peserta ganjil (pasangan kedua B kosong — single, bukan
		// ganda) supaya total kok tidak habis dibagi rata, memaksa
		// pembulatan (§9.5 aturan A).
		Pairs: []V2Pair{
			{ID: "p0", Slot: 0, A: "Rian", B: "Andre"},
			{ID: "p1", Slot: 1, A: "Bagus", B: ""},
		},
	}
	tour.Koks = []V2TournamentKok{
		{TypeName: t3ptr("Kok"), PricePerPerson: 2500, MatchID: nil, Date: "2026-08-05"},
	}
	tour.Fees = []V2TournamentFee{{Name: "Rian"}, {Name: "Andre"}, {Name: "Bagus"}}
	tour.CreatedAt, tour.UpdatedAt = knockoutFixtureTime, knockoutFixtureTime

	fixture := &fakeReader{tournaments: []V2Tournament{tour}}
	slug := testSlug(t)
	mapping := NameMapping{"Rian": "Rian", "Andre": "Andre", "Bagus": "Bagus"}

	result, err := Migrate(context.Background(), fixture, s, mapping, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// total kok = 2500*4 = 10000, dibagi 3 peserta -> ceil ke ratusan:
	// 10000/300 = 33.33 -> 34 -> Rp3400/orang. 3400*3=10200, pembulatan
	// 200 masuk kas sebagai expense negatif (kas masuk).
	err = s.WithClub(context.Background(), result.ClubID, func(ctx context.Context, q *gen.Queries) error {
		tID := tournamentID(slug, "tour2")
		charges, err := q.SumMatchKokCharges(ctx, tID)
		if err != nil {
			return err
		}
		if charges != 10200 {
			t.Errorf("total tagihan kok umum = %d, mau 10200 (3400 x 3)", charges)
		}
		expenseTotal, err := q.SumExpenses(ctx, result.ClubID)
		if err != nil {
			return err
		}
		if expenseTotal != -200 {
			t.Errorf("expense pembulatan = %d, mau -200 (kas masuk)", expenseTotal)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi: %v", err)
	}
}

func TestMigrate_TournamentRoundRobin(t *testing.T) {
	s := store.New(testdb.Pool(t))
	tour := V2Tournament{
		ID: "tour3", Name: "RR Tes", Date: "2026-08-05", Size: 3, Format: "round_robin", Fee: 0, ScoreFormat: "single",
		Pairs: []V2Pair{
			{ID: "p0", Slot: 0, A: "Rian", B: "Andre"},
			{ID: "p1", Slot: 1, A: "Bagus", B: "Tio"},
			{ID: "p2", Slot: 2, A: "Cahyo", B: "Dedi"},
		},
		Results: map[string]V2MatchScore{
			"rr0-1": {Format: "single", Games: []V2GameScore{{A: 21, B: 10}}},
			"rr0-2": {Format: "single", Games: []V2GameScore{{A: 21, B: 12}}},
			// rr1-2 belum dimainkan.
		},
		CreatedAt: knockoutFixtureTime, UpdatedAt: knockoutFixtureTime,
	}
	fixture := &fakeReader{tournaments: []V2Tournament{tour}}
	slug := testSlug(t)
	mapping := NameMapping{"Rian": "Rian", "Andre": "Andre", "Bagus": "Bagus", "Tio": "Tio", "Cahyo": "Cahyo", "Dedi": "Dedi"}

	result, err := Migrate(context.Background(), fixture, s, mapping, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatalf("Migrate round robin: %v", err)
	}
	if result.PartaiCount != 2 {
		t.Fatalf("PartaiCount = %d, mau 2 (rr0-1 + rr0-2, rr1-2 belum)", result.PartaiCount)
	}
}
