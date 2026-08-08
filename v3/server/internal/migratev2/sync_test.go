// Test sync HIDUP v2->v3 (SyncOnce, cmd/sync-v2). Beda fokus dari
// migrate_test.go (Migrate, one-shot verified): di sini yang diuji
// adalah properti KHUSUS sync berulang — idempoten tanpa perubahan,
// perubahan v2 (status lunas) ikut menyebar di putaran berikutnya, nama
// belum dipetakan cuma melewati baris terkait (bukan menggagalkan
// putaran), dan carry delta bukan overwrite.
package migratev2

import (
	"context"
	"testing"
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func TestSyncOnce_IdempotentWithoutChanges(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	slug := testSlug(t)
	opts := Options{ClubSlug: slug, ClubName: "Klub Sync Test", Timezone: "Asia/Jakarta", AdminName: "Rian"}

	first, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce pertama: %v", err)
	}
	if first.GamesInserted != 2 {
		t.Errorf("GamesInserted putaran 1 = %d, mau 2", first.GamesInserted)
	}
	if first.WalletTopups != 1 {
		t.Errorf("WalletTopups putaran 1 = %d, mau 1", first.WalletTopups)
	}

	second, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce kedua: %v", err)
	}
	if second.GamesInserted != 0 || second.GamesUpdated != 0 {
		t.Errorf("putaran kedua (tanpa perubahan v2) harusnya nol tulis: inserted=%d updated=%d", second.GamesInserted, second.GamesUpdated)
	}
	if second.GamesUnchanged != 2 {
		t.Errorf("GamesUnchanged putaran 2 = %d, mau 2", second.GamesUnchanged)
	}
	if second.WalletTopups != 0 {
		t.Errorf("WalletTopups putaran 2 = %d, mau 0 (carry tidak berubah)", second.WalletTopups)
	}
}

func TestSyncOnce_PropagatesPaidStatusChangeOnRerun(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	slug := testSlug(t)
	opts := Options{ClubSlug: slug, ClubName: "Klub Sync Test", Timezone: "Asia/Jakarta", AdminName: "Rian"}

	if _, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts); err != nil {
		t.Fatalf("SyncOnce pertama: %v", err)
	}

	// Alur v2 paling umum: Bagus bayar BELAKANGAN buat game g1 (awalnya
	// Paid=false), dan v2 membumbui games.updated_at (JSON players
	// berubah). SyncOnce kedua harus menangkap ini lewat watermark.
	newPaidAt := time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)
	for i := range fixture.games[0].Players {
		if fixture.games[0].Players[i].Name == "Bagus" {
			fixture.games[0].Players[i].Paid = true
			fixture.games[0].Players[i].PaidAt = &newPaidAt
		}
	}
	fixture.games[0].UpdatedAt = newPaidAt

	result, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce kedua: %v", err)
	}
	if result.GamesUpdated != 1 {
		t.Errorf("GamesUpdated putaran 2 = %d, mau 1 (g1 berubah)", result.GamesUpdated)
	}
	if result.GamesUnchanged != 1 {
		t.Errorf("GamesUnchanged putaran 2 = %d, mau 1 (g2 tidak berubah)", result.GamesUnchanged)
	}

	err = s.WithClub(context.Background(), result.ClubID, func(ctx context.Context, q *gen.Queries) error {
		gID := gameID(slug, "g1")
		players, err := q.ListGamePlayersByGame(ctx, gID)
		if err != nil {
			return err
		}
		bagusID := userID(slug, "Bagus")
		for _, p := range players {
			if p.UserID == bagusID {
				if !p.PaidAt.Valid {
					t.Error("Bagus mau paid_at terisi setelah sync ulang, masih NULL")
				}
				return nil
			}
		}
		t.Error("baris game_player Bagus tidak ketemu")
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi: %v", err)
	}
}

func TestSyncOnce_MissingMappingSkipsOnlyAffectedRowsNotWholeRun(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture()
	slug := testSlug(t)
	incomplete := NameMapping{"Rian": "Rian", "Andre": "Andre", "Bagus": "Bagus"} // Tio hilang
	opts := Options{ClubSlug: slug, ClubName: "Klub Sync Test", Timezone: "Asia/Jakarta", AdminName: "Rian"}

	result, err := SyncOnce(context.Background(), fixture, s, incomplete, opts)
	if err != nil {
		t.Fatalf("SyncOnce harusnya TIDAK error walau ada nama belum dipetakan: %v", err)
	}
	if len(result.SkippedForMapping) == 0 {
		t.Fatal("mau Tio muncul di SkippedForMapping")
	}
	found := false
	for _, n := range result.SkippedForMapping {
		if n == "Tio" {
			found = true
		}
	}
	if !found {
		t.Errorf("SkippedForMapping = %v, mau memuat \"Tio\"", result.SkippedForMapping)
	}
	// Kedua game melibatkan Tio (baseFixture) -> keduanya dilewati, bukan
	// error total.
	if result.GamesInserted != 0 {
		t.Errorf("GamesInserted = %d, mau 0 (kedua game fixture melibatkan Tio yang belum dipetakan)", result.GamesInserted)
	}
	// Rian/Andre/Bagus tetap harus ke-upsert sebagai user walau game
	// mereka ikut dilewati (mereka juga terdaftar players[], jalur
	// terpisah dari game).
	if result.UsersUpserted < 3 {
		t.Errorf("UsersUpserted = %d, mau >=3 (Rian/Andre/Bagus tetap tersync lepas dari game)", result.UsersUpserted)
	}
}

func TestSyncOnce_CarryDeltaOnlyWritesTheDifference(t *testing.T) {
	s := store.New(testdb.Pool(t))
	fixture := baseFixture() // Rian carry=15000
	slug := testSlug(t)
	opts := Options{ClubSlug: slug, ClubName: "Klub Sync Test", Timezone: "Asia/Jakarta", AdminName: "Rian"}

	first, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce pertama: %v", err)
	}
	if first.WalletTopups != 1 {
		t.Fatalf("WalletTopups putaran 1 = %d, mau 1", first.WalletTopups)
	}

	// Carry v2 NAIK (Rian dapat titipan tambahan) — putaran berikutnya
	// mau nulis SATU wallet_entry baru buat SELISIHnya (5000), bukan
	// menimpa baris lama atau menulis ulang 20000.
	fixture.carry[0].Carry = 20000
	second, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce kedua: %v", err)
	}
	if second.WalletTopups != 1 {
		t.Errorf("WalletTopups putaran 2 = %d, mau 1 (delta baru)", second.WalletTopups)
	}

	err = s.WithClub(context.Background(), first.ClubID, func(ctx context.Context, q *gen.Queries) error {
		bal, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: first.ClubID, UserID: userID(slug, "Rian")})
		if err != nil {
			return err
		}
		if bal != 20000 {
			t.Errorf("saldo dompet Rian = %d, mau 20000 (15000 awal + 5000 delta, bukan ditimpa/dobel)", bal)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi saldo: %v", err)
	}

	// Carry TURUN — tidak ditarik otomatis, cuma dilaporkan.
	fixture.carry[0].Carry = 12000
	third, err := SyncOnce(context.Background(), fixture, s, fullMapping(), opts)
	if err != nil {
		t.Fatalf("SyncOnce ketiga: %v", err)
	}
	if len(third.SkippedCarryDecreases) != 1 {
		t.Errorf("SkippedCarryDecreases putaran 3 = %v, mau 1 entri (Rian turun)", third.SkippedCarryDecreases)
	}
	if third.WalletTopups != 0 {
		t.Errorf("WalletTopups putaran 3 = %d, mau 0 (penurunan tidak ditarik otomatis)", third.WalletTopups)
	}
	err = s.WithClub(context.Background(), first.ClubID, func(ctx context.Context, q *gen.Queries) error {
		bal, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: first.ClubID, UserID: userID(slug, "Rian")})
		if err != nil {
			return err
		}
		if bal != 20000 {
			t.Errorf("saldo dompet Rian setelah carry v2 turun = %d, mau TETAP 20000 (tidak ditarik otomatis)", bal)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("verifikasi saldo pasca-penurunan: %v", err)
	}
}
