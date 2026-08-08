// Test tunggakan lewat batas (PLAN.md §10.3). Beda dari test lain di
// paket ini (notify_test.go domain — itu di internal/domain) — di sini
// butuh Postgres sungguhan karena menghitung tunggakan lintas tabel
// games/game_players/clubs.
package notify_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// TestOverdueScanner_FlagsOldBigDebt_ThenRespectsCooldown — dua syarat
// DAN (umur ≥14 hari, nominal ≥ Rp50.000) sama-sama harus terpenuhi
// sebelum diingatkan, dan sekali diingatkan tidak diulang sebelum jeda
// 7 hari lewat (dua-duanya bawaan §17).
func TestOverdueScanner_FlagsOldBigDebt_ThenRespectsCooldown(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ctx := context.Background()

	var clubID, payerID, gameID uuid.UUID
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		c, err := q.CreateClub(ctx, gen.CreateClubParams{
			ID: uuid.New(), Slug: "overdue-test-" + uuid.NewString()[:8], Name: "Klub Overdue Test",
			Timezone: "Asia/Jakarta", Settings: []byte(`{}`), Quotas: []byte(`{}`),
		})
		if err != nil {
			return err
		}
		clubID = c.ID
		u, err := q.CreateUnclaimedUser(ctx, "Penunggak")
		if err != nil {
			return err
		}
		payerID = u.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	oldDate := time.Now().AddDate(0, 0, -20)
	err = s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		g, err := q.CreateGame(ctx, gen.CreateGameParams{
			ClubID: clubID, PlayedOn: dateOf(oldDate), Format: gen.GameFormatSingle,
		})
		if err != nil {
			return err
		}
		gameID = g.ID
		_, err = q.CreateGamePlayer(ctx, gen.CreateGamePlayerParams{
			GameID: gameID, ClubID: clubID, UserID: payerID, PayerID: payerID,
			Side: gen.GameSideA, Slot: 1, Amount: 60000, // di atas ambang bawaan Rp50.000
		})
		return err
	})
	if err != nil {
		t.Fatalf("setup game: %v", err)
	}

	scanner := notify.NewOverdueScanner(s, discardLogger())
	if err := scanner.ScanOnce(ctx); err != nil {
		t.Fatalf("scan 1: %v", err)
	}

	var rows []gen.Notification
	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		rows, err = q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{UserID: payerID})
		return err
	})
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	debtRows := filterKind(rows, "debt_overdue")
	if len(debtRows) != 1 {
		t.Fatalf("baris debt_overdue setelah scan 1 = %d, mau 1: %+v", len(debtRows), rows)
	}

	// Scan lagi SEKETIKA — jeda 7 hari belum lewat, tidak boleh nambah baris.
	if err := scanner.ScanOnce(ctx); err != nil {
		t.Fatalf("scan 2: %v", err)
	}
	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		rows, err = q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{UserID: payerID})
		return err
	})
	if err != nil {
		t.Fatalf("list notifications 2: %v", err)
	}
	if got := len(filterKind(rows, "debt_overdue")); got != 1 {
		t.Fatalf("baris debt_overdue setelah scan 2 (seketika) = %d, mau tetap 1 (jeda 7 hari belum lewat)", got)
	}
}

// TestOverdueScanner_SkipsRecentOrSmallDebt — umur belum cukup ATAU
// nominal di bawah ambang, dua-duanya tidak boleh memicu pengingat.
func TestOverdueScanner_SkipsRecentOrSmallDebt(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ctx := context.Background()

	var clubID, recentPayer, smallPayer uuid.UUID
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		c, err := q.CreateClub(ctx, gen.CreateClubParams{
			ID: uuid.New(), Slug: "overdue-skip-" + uuid.NewString()[:8], Name: "Klub Overdue Skip",
			Timezone: "Asia/Jakarta", Settings: []byte(`{}`), Quotas: []byte(`{}`),
		})
		if err != nil {
			return err
		}
		clubID = c.ID
		u1, err := q.CreateUnclaimedUser(ctx, "Baru Nunggak")
		if err != nil {
			return err
		}
		recentPayer = u1.ID
		u2, err := q.CreateUnclaimedUser(ctx, "Nunggak Receh")
		if err != nil {
			return err
		}
		smallPayer = u2.ID
		return nil
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	err = s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		// Baru 2 hari — belum lewat ambang 14 hari, walau nominalnya besar.
		g1, err := q.CreateGame(ctx, gen.CreateGameParams{ClubID: clubID, PlayedOn: dateOf(time.Now().AddDate(0, 0, -2)), Format: gen.GameFormatSingle})
		if err != nil {
			return err
		}
		if _, err := q.CreateGamePlayer(ctx, gen.CreateGamePlayerParams{
			GameID: g1.ID, ClubID: clubID, UserID: recentPayer, PayerID: recentPayer,
			Side: gen.GameSideA, Slot: 1, Amount: 100000,
		}); err != nil {
			return err
		}
		// Tua (20 hari) tapi nominalnya kecil — di bawah ambang Rp50.000.
		g2, err := q.CreateGame(ctx, gen.CreateGameParams{ClubID: clubID, PlayedOn: dateOf(time.Now().AddDate(0, 0, -20)), Format: gen.GameFormatSingle})
		if err != nil {
			return err
		}
		_, err = q.CreateGamePlayer(ctx, gen.CreateGamePlayerParams{
			GameID: g2.ID, ClubID: clubID, UserID: smallPayer, PayerID: smallPayer,
			Side: gen.GameSideA, Slot: 1, Amount: 10000,
		})
		return err
	})
	if err != nil {
		t.Fatalf("setup games: %v", err)
	}

	scanner := notify.NewOverdueScanner(s, discardLogger())
	if err := scanner.ScanOnce(ctx); err != nil {
		t.Fatalf("scan: %v", err)
	}

	for _, uid := range []uuid.UUID{recentPayer, smallPayer} {
		var rows []gen.Notification
		err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{UserID: uid})
			return err
		})
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if got := len(filterKind(rows, "debt_overdue")); got != 0 {
			t.Fatalf("user %s dapat %d pengingat, mau 0 (belum penuhi dua syarat sekaligus)", uid, got)
		}
	}
}

func filterKind(rows []gen.Notification, kind string) []gen.Notification {
	var out []gen.Notification
	for _, r := range rows {
		if r.Kind == kind {
			out = append(out, r)
		}
	}
	return out
}

func dateOf(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}
