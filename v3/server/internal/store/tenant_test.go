package store_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

var phoneSalt = time.Now().UnixNano()

func testPhone() string {
	phoneSalt++
	return fmt.Sprintf("+62%013d", phoneSalt%10_000_000_000_000)
}

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

// TestWithUser_SelfReadCrossClub_NoCrossUserLeak menguji migrasi 00021
// (policy memberships_tenant_read): user boleh baca baris memberships
// MILIKNYA SENDIRI lintas klub lewat WithUser, tapi tidak pernah baris
// milik user lain — dan jalur tulis (INSERT/UPDATE/DELETE) tetap murni
// club_id = current_club() seperti sebelumnya, tidak ikut melonggar.
func TestWithUser_SelfReadCrossClub_NoCrossUserLeak(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ctx := context.Background()

	clubA, clubB := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{clubA, clubB} {
		err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.CreateClub(ctx, gen.CreateClubParams{
				ID: id, Slug: "test-" + id.String(), Name: "Test " + id.String(), Timezone: "Asia/Jakarta",
				Settings: []byte(`{}`), Quotas: []byte(`{}`),
			})
			return err
		})
		if err != nil {
			t.Fatalf("setup klub: %v", err)
		}
	}

	var userX, userY gen.User
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		userX, err = q.CreateUser(ctx, gen.CreateUserParams{Phone: pgtype.Text{String: testPhone(), Valid: true}, DisplayName: "X"})
		if err != nil {
			return err
		}
		userY, err = q.CreateUser(ctx, gen.CreateUserParams{Phone: pgtype.Text{String: testPhone(), Valid: true}, DisplayName: "Y"})
		return err
	})
	if err != nil {
		t.Fatalf("setup users: %v", err)
	}

	// userX anggota klub A DAN klub B; userY cuma anggota klub A — supaya
	// kebocoran lintas-USER (bukan cuma lintas-klub) juga ketahuan.
	err = s.WithClub(ctx, clubA, func(ctx context.Context, q *gen.Queries) error {
		if _, err := q.CreateMembership(ctx, gen.CreateMembershipParams{ClubID: clubA, UserID: userX.ID, Role: gen.ClubRoleMember}); err != nil {
			return err
		}
		_, err := q.CreateMembership(ctx, gen.CreateMembershipParams{ClubID: clubA, UserID: userY.ID, Role: gen.ClubRoleMember})
		return err
	})
	if err != nil {
		t.Fatalf("setup membership klub A: %v", err)
	}
	err = s.WithClub(ctx, clubB, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateMembership(ctx, gen.CreateMembershipParams{ClubID: clubB, UserID: userX.ID, Role: gen.ClubRoleMember})
		return err
	})
	if err != nil {
		t.Fatalf("setup membership klub B: %v", err)
	}

	// userX lewat WithUser (app.user_id doang, app.club_id TIDAK diset)
	// harus lihat PERSIS 2 baris: klub A dan klub B, keduanya miliknya.
	var rowsX []gen.ListMembershipsWithClubByUserRow
	err = s.WithUser(ctx, userX.ID, func(ctx context.Context, q *gen.Queries) error {
		var err error
		rowsX, err = q.ListMembershipsWithClubByUser(ctx, userX.ID)
		return err
	})
	if err != nil {
		t.Fatalf("WithUser userX: %v", err)
	}
	if len(rowsX) != 2 {
		t.Fatalf("userX harus lihat 2 membership (klub A + B), dapat %d: %+v", len(rowsX), rowsX)
	}

	// userY (sesi userX MASIH aktif secara konseptual, tapi ini panggilan
	// WithUser terpisah dgn app.user_id=userY) harus cuma lihat klub A —
	// TIDAK boleh ikut lihat baris userX di klub B ataupun di klub A.
	var rowsY []gen.ListMembershipsWithClubByUserRow
	err = s.WithUser(ctx, userY.ID, func(ctx context.Context, q *gen.Queries) error {
		var err error
		rowsY, err = q.ListMembershipsWithClubByUser(ctx, userY.ID)
		return err
	})
	if err != nil {
		t.Fatalf("WithUser userY: %v", err)
	}
	if len(rowsY) != 1 || rowsY[0].ClubID != clubA {
		t.Fatalf("userY harus cuma lihat 1 membership (klub A), dapat %+v", rowsY)
	}

	// Kebocoran lintas-user lewat query mentah userX (kalau dilewatkan
	// userY.ID ke ListMembershipsWithClubByUser dalam sesi WithUser milik
	// userX, RLS tetap harus menyaring ke 0 — user_id di WHERE bukan
	// jaminan tunggal, current_user_id() di policy juga harus cocok).
	var crossRows []gen.ListMembershipsWithClubByUserRow
	err = s.WithUser(ctx, userX.ID, func(ctx context.Context, q *gen.Queries) error {
		var err error
		crossRows, err = q.ListMembershipsWithClubByUser(ctx, userY.ID)
		return err
	})
	if err != nil {
		t.Fatalf("WithUser userX minta baris userY: %v", err)
	}
	if len(crossRows) != 0 {
		t.Fatalf("RLS bocor: sesi app.user_id=userX melihat %d baris membership milik userY (harus 0)", len(crossRows))
	}

	// Jalur TULIS tidak boleh ikut melonggar — UpdateMembershipRole lewat
	// WithUser (app.club_id TIDAK diset) harus gagal (0 baris cocok),
	// persis seperti sebelum migrasi 00021.
	err = s.WithUser(ctx, userX.ID, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.UpdateMembershipRole(ctx, gen.UpdateMembershipRoleParams{
			ClubID: clubA, UserID: userX.ID, Role: gen.ClubRoleAdmin,
		})
		return err
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("tulis memberships lewat WithUser (tanpa club_id) harus gagal fail-closed (pgx.ErrNoRows), dapat: %v", err)
	}
}
