// Test F10 (PLAN.md §14, "Selesai kalau" — cakupan pass ini: pemain,
// kok_types, main harian, pengeluaran, carry→dompet; TURNAMEN DI LUAR
// CAKUPAN, lihat komentar package migratev2). Butuh Postgres v3
// sungguhan (testdb, pola sama internal/http) — sisi v2 dipalsu lewat
// fakeReader supaya logic migrasi teruji TANPA butuh database v2
// sungguhan berisi data (reader.go/PgReader sendiri cuma SELECT tipis,
// risiko rendah, tidak diuji ulang di sini).
package migratev2

import (
	"context"
	"fmt"
	"math/rand"
	"testing"
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

type fakeReader struct {
	players     []V2Player
	carry       []V2Carry
	kokTypes    []V2KokType
	games       []V2Game
	expenses    []V2Expense
	tournaments []V2Tournament
}

func (f *fakeReader) Players(context.Context) ([]V2Player, error)         { return f.players, nil }
func (f *fakeReader) Carry(context.Context) ([]V2Carry, error)            { return f.carry, nil }
func (f *fakeReader) KokTypes(context.Context) ([]V2KokType, error)       { return f.kokTypes, nil }
func (f *fakeReader) Games(context.Context) ([]V2Game, error)             { return f.games, nil }
func (f *fakeReader) Expenses(context.Context) ([]V2Expense, error)       { return f.expenses, nil }
func (f *fakeReader) Tournaments(context.Context) ([]V2Tournament, error) { return f.tournaments, nil }

func testSlug(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("mig-test-%d-%d", time.Now().UnixNano(), rand.Intn(1_000_000))
}

func t3ptr(s string) *string { return &s }

// baseFixture — 4 pemain, satu kok_type, dua game (ganda 4 orang, sesuai
// yang v2 selalu simpan), satu expense, satu carry. Cukup buat menguji
// semua jalur tulis+verifikasi sekaligus tanpa jadi berlebihan.
func baseFixture() *fakeReader {
	paidAt := time.Date(2026, 7, 18, 10, 0, 0, 0, time.UTC)
	return &fakeReader{
		players: []V2Player{{Name: "Rian"}, {Name: "Andre"}, {Name: "Bagus"}, {Name: "Tio"}},
		carry:   []V2Carry{{Name: "Rian", Carry: 15000}},
		kokTypes: []V2KokType{
			{ID: "kt1", Name: "Yonex AS50", PricePerPerson: 3000, PricePerSlop: 36000, Stock: 10, Active: true},
		},
		games: []V2Game{
			{
				ID: "g1", Date: "2026-07-18",
				Players: []V2GamePlayer{
					{Name: "Rian", Paid: true, PaidAt: &paidAt},
					{Name: "Andre", Paid: true, PaidAt: &paidAt},
					{Name: "Bagus", Paid: false},
					{Name: "Tio", Paid: false},
				},
				Koks:       []V2GameKok{{TypeID: t3ptr("kt1"), TypeName: t3ptr("Yonex AS50"), PricePerPerson: 3000}},
				RecordedBy: t3ptr("Rian"),
				CreatedAt:  paidAt, UpdatedAt: paidAt,
			},
			{
				ID: "g2", Date: "2026-07-19",
				Players: []V2GamePlayer{
					{Name: "Rian", Paid: false},
					{Name: "Andre", Paid: false},
					{Name: "Bagus", Paid: true, PaidAt: &paidAt},
					{Name: "Tio", Paid: true, PaidAt: &paidAt},
				},
				Koks:       []V2GameKok{{PricePerPerson: 3000}, {PricePerPerson: 3000}}, // tanpa typeId — kok generik
				RecordedBy: t3ptr("Admin"),                                              // TIDAK ada di players — fallback teks
				CreatedAt:  paidAt.Add(time.Hour), UpdatedAt: paidAt.Add(time.Hour),
			},
		},
		expenses: []V2Expense{{ID: "e1", Amount: 4000, TypeName: t3ptr("beli kok"), CreatedAt: paidAt}},
	}
}

func fullMapping() NameMapping {
	return NameMapping{"Rian": "Rian", "Andre": "Andre", "Bagus": "Bagus", "Tio": "Tio"}
}

func TestMigrate_HappyPath(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	slug := testSlug(t)
	opts := Options{ClubSlug: slug, ClubName: "Klub Migrasi Test", Timezone: "Asia/Jakarta", AdminName: "Rian"}

	result, err := Migrate(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if result.UsersCreated != 4 {
		t.Errorf("UsersCreated = %d, mau 4", result.UsersCreated)
	}
	if result.GamesCreated != 2 {
		t.Errorf("GamesCreated = %d, mau 2", result.GamesCreated)
	}
	if result.KokTypesCreated != 1 {
		t.Errorf("KokTypesCreated = %d, mau 1", result.KokTypesCreated)
	}
	if result.ExpensesCreated != 1 {
		t.Errorf("ExpensesCreated = %d, mau 1", result.ExpensesCreated)
	}
	if result.WalletTopups != 1 {
		t.Errorf("WalletTopups = %d, mau 1", result.WalletTopups)
	}
	// kas net: game1 paid (Rian+Andre) 2*3000=6000, game2 paid
	// (Bagus+Tio) 2*(3000+3000)=12000 -> paid=18000, expense=4000,
	// net=14000.
	if result.KasNet != 14000 {
		t.Errorf("KasNet = %d, mau 14000", result.KasNet)
	}

	// Admin membership sungguhan tertanam (Rian).
	err = s.WithClub(context.Background(), result.ClubID, func(ctx context.Context, q *gen.Queries) error {
		rianID := userID(slug, "Rian")
		m, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: result.ClubID, UserID: rianID})
		if err != nil {
			return err
		}
		if m.Role != gen.ClubRoleAdmin {
			t.Errorf("role Rian = %s, mau admin", m.Role)
		}
		bal, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: result.ClubID, UserID: rianID})
		if err != nil {
			return err
		}
		if bal != 15000 {
			t.Errorf("saldo dompet Rian = %d, mau 15000 (carry v2)", bal)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi pasca-migrasi: %v", err)
	}

	// Idempoten — jalan dua kali, hasil counts SAMA, tidak ada duplikat
	// (kalau ON CONFLICT gagal jadi DO NOTHING sungguhan, unique
	// constraint bakal meledak duluan sebelum sempat balik ke sini).
	result2, err := Migrate(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("Migrate kedua (idempotensi): %v", err)
	}
	if result2.ClubID != result.ClubID || result2.GamesCreated != 2 || result2.UsersCreated != 4 {
		t.Fatalf("hasil migrasi kedua beda dari yang pertama: %+v vs %+v", result2, result)
	}
}

func TestMigrate_RejectsMissingMapping(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	slug := testSlug(t)
	incomplete := NameMapping{"Rian": "Rian", "Andre": "Andre", "Bagus": "Bagus"} // Tio hilang

	_, err := Migrate(context.Background(), fixture, s, incomplete, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta"})
	if err == nil {
		t.Fatal("Migrate harusnya menolak — nama Tio belum dipetakan")
	}

	err2 := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		_, err := q.GetClubBySlug(ctx, slug)
		return err
	})
	if err2 == nil {
		t.Fatal("klub TIDAK BOLEH tercipta ketika mapping belum lengkap — migrasi harus berhenti sebelum menulis apa pun")
	}
}

func TestMigrate_RejectsGameNotFourPlayers(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	fixture.games[0].Players = fixture.games[0].Players[:3] // cuma 3 terisi
	slug := testSlug(t)

	_, err := Migrate(context.Background(), fixture, s, fullMapping(), Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta"})
	if err == nil {
		t.Fatal("Migrate harusnya menolak game yang bukan ganda 4 orang")
	}
}

func TestMigrate_MergesCarryWhenNamesMappedToSameCanonical(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	fixture.players = append(fixture.players, V2Player{Name: "Rian2"})
	fixture.carry = append(fixture.carry, V2Carry{Name: "Rian2", Carry: 5000})
	slug := testSlug(t)

	mapping := fullMapping()
	mapping["Rian2"] = "Rian" // dua alias v2 -> satu orang kanonik

	result, err := Migrate(context.Background(), fixture, s, mapping, Options{ClubSlug: slug, ClubName: "X", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	// Rian2 tidak pernah main/nunggak — cuma nambah user + carry. Total
	// user tetap 4 (Rian2 melebur ke Rian), bukan 5.
	if result.UsersCreated != 4 {
		t.Fatalf("UsersCreated = %d, mau 4 (Rian2 melebur ke Rian, bukan user baru)", result.UsersCreated)
	}

	err = s.WithClub(context.Background(), result.ClubID, func(ctx context.Context, q *gen.Queries) error {
		bal, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: result.ClubID, UserID: userID(slug, "Rian")})
		if err != nil {
			return err
		}
		if bal != 20000 {
			t.Errorf("saldo dompet Rian = %d, mau 20000 (15000 + 5000 dari Rian2 yang digabung)", bal)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi: %v", err)
	}
}
