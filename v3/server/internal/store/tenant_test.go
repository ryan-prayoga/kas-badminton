package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

// TestWithClub_NoLeakAcrossReusedConnection adalah skenario yang secara
// eksplisit diminta PLAN.md §6.2: "RLS di atas connection pool punya
// jebakan ... harus mencakup kasus koneksi dipakai ulang". Pool dibatasi
// MaxConns=1 supaya dua transaksi berurutan (klub A lalu klub B) DIJAMIN
// memakai koneksi fisik yang sama — kalau SET LOCAL app.club_id "bocor"
// antar transaksi di koneksi itu, test ini gagal.
func TestWithClub_NoLeakAcrossReusedConnection(t *testing.T) {
	pool := testdb.SingleConnPool(t)
	s := store.New(pool)
	ctx := context.Background()

	clubA, clubB := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{clubA, clubB} {
		err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.CreateClub(ctx, gen.CreateClubParams{
				ID: id, Slug: "test-" + id.String(), Name: "Test", Timezone: "Asia/Jakarta",
				Settings: []byte(`{}`), Quotas: []byte(`{}`),
			})
			return err
		})
		if err != nil {
			t.Fatalf("setup klub: %v", err)
		}
	}

	// Isi satu baris kok_types di klub A, di koneksi (satu-satunya) yang
	// dipegang pool.
	err := s.WithClub(ctx, clubA, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateKokType(ctx, gen.CreateKokTypeParams{ClubID: clubA, Name: "Kok A", PricePerPerson: 1000})
		return err
	})
	if err != nil {
		t.Fatalf("insert kok_types klub A: %v", err)
	}

	// Transaksi BERIKUTNYA, tenant klub B, DIJAMIN pakai koneksi fisik
	// yang sama (MaxConns=1). Query eksplisit minta baris klub A — kalau
	// SET LOCAL sebelumnya bocor (tidak ter-reset), atau RLS terlewati,
	// ini akan salah mengembalikan 1.
	var countFromClubBContext int64
	err = s.WithClub(ctx, clubB, func(ctx context.Context, q *gen.Queries) error {
		var err error
		countFromClubBContext, err = q.CountKokTypesByClub(ctx, clubA)
		return err
	})
	if err != nil {
		t.Fatalf("query dari konteks klub B: %v", err)
	}
	if countFromClubBContext != 0 {
		t.Fatalf("RLS bocor: konteks klub B melihat %d baris milik klub A (harus 0) — koneksi dipakai ulang tanpa SET LOCAL ter-reset", countFromClubBContext)
	}

	// Sanity check: dari konteks klub A sendiri, barisnya memang ada.
	var countFromClubAContext int64
	err = s.WithClub(ctx, clubA, func(ctx context.Context, q *gen.Queries) error {
		var err error
		countFromClubAContext, err = q.CountKokTypesByClub(ctx, clubA)
		return err
	})
	if err != nil {
		t.Fatalf("query dari konteks klub A: %v", err)
	}
	if countFromClubAContext != 1 {
		t.Fatalf("sanity check gagal: konteks klub A sendiri harus melihat 1 baris, dapat %d", countFromClubAContext)
	}
}
