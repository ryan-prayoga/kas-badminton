// cmd/seed mengisi database dev dengan data contoh, supaya developer bisa
// jalan tanpa menyentuh WhatsApp produksi (PLAN.md §12: "Lingkungan dev
// tanpa WA. Notifier palsu ... plus data seed").
//
// Lewat jalur domain yang sama dengan handler (internal/http/games.go)
// supaya datanya konsisten dengan apa yang app sungguhan akan hasilkan —
// bukan INSERT mentah yang bisa diam-diam menyimpang dari invarian §3.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func main() {
	if err := run(); err != nil {
		slog.Error("seed gagal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.Env, cfg.LogLevel)

	if cfg.Env == "prod" {
		logger.Error("seed menolak jalan di ENV=prod — ini cuma buat dev")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return err
	}
	logger.Info("koneksi database ok")

	s := store.New(pool)

	names := []struct{ phone, name string }{
		{"+628000000001", "Andi"},
		{"+628000000002", "Budi"},
		{"+628000000003", "Citra"},
		{"+628000000004", "Dewi"},
	}

	var users []gen.User
	for _, n := range names {
		u, err := findOrCreateUser(ctx, s, n.phone, n.name)
		if err != nil {
			return err
		}
		users = append(users, u)
	}

	clubID := uuid.New()
	var kokType gen.KokType
	err = s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateClub(ctx, gen.CreateClubParams{
			ID:        clubID,
			Slug:      "pb-contoh",
			Name:      "PB Contoh",
			Timezone:  "Asia/Jakarta",
			Settings:  []byte(`{"siapa_boleh_catat":"semua_anggota","transparansi_kas":true}`),
			Quotas:    []byte(`{}`),
			CreatedBy: &users[0].ID,
		})
		if err != nil {
			return err
		}
		for i, u := range users {
			role := gen.ClubRoleMember
			if i == 0 {
				role = gen.ClubRoleAdmin
			}
			if _, err := q.CreateMembership(ctx, gen.CreateMembershipParams{ClubID: clubID, UserID: u.ID, Role: role}); err != nil {
				return err
			}
		}
		kt, err := q.CreateKokType(ctx, gen.CreateKokTypeParams{ClubID: clubID, Name: "Kok Victor 3", PricePerPerson: 4000})
		if err != nil {
			return err
		}
		kokType = kt
		return nil
	})
	if err != nil {
		return err
	}

	// Dua main contoh, dihitung lewat domain.GameCostOf yang sama dengan
	// handler POST games — bukan angka hardcode.
	for i := 0; i < 2; i++ {
		cost := domain.GameCostOf([]domain.Kok{{Price: kokType.PricePerPerson * 2}}, 4)
		playedOn := time.Now().AddDate(0, 0, -i)
		err = s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
			g, err := q.CreateGame(ctx, gen.CreateGameParams{
				ClubID:     clubID,
				PlayedOn:   pgtype.Date{Time: playedOn, Valid: true},
				Format:     gen.GameFormatGanda,
				RecordedBy: &users[0].ID,
			})
			if err != nil {
				return err
			}
			if _, err := q.CreateGameKok(ctx, gen.CreateGameKokParams{
				GameID: g.ID, ClubID: clubID, KokTypeID: &kokType.ID,
				TypeName:       pgtype.Text{String: kokType.Name, Valid: true},
				PricePerPerson: kokType.PricePerPerson, Qty: 2,
			}); err != nil {
				return err
			}
			sides := []gen.GameSide{gen.GameSideA, gen.GameSideA, gen.GameSideB, gen.GameSideB}
			for slot, u := range users {
				if _, err := q.CreateGamePlayer(ctx, gen.CreateGamePlayerParams{
					GameID: g.ID, ClubID: clubID, UserID: u.ID, PayerID: u.ID,
					Side: sides[slot], Slot: int16(slot%2 + 1), Amount: cost.PerPerson,
				}); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	logger.Info("seed selesai", "club_slug", "pb-contoh")
	for _, n := range names {
		logger.Info("dev login", "phone", n.phone, "curl",
			`curl -XPOST localhost:8300/api/v1/dev/login -d '{"phone":"`+n.phone+`"}'`)
	}

	return nil
}

func findOrCreateUser(ctx context.Context, s *store.Store, phone, name string) (gen.User, error) {
	var user gen.User
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		found, err := q.GetUserByPhone(ctx, pgtype.Text{String: phone, Valid: true})
		if err == nil {
			user = found
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		created, err := q.CreateUser(ctx, gen.CreateUserParams{
			Phone:       pgtype.Text{String: phone, Valid: true},
			DisplayName: name,
		})
		if err != nil {
			return err
		}
		user = created
		return nil
	})
	return user, err
}
