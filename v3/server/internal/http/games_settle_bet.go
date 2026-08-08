// Taruhan kok "yang kalah bayar kok" (PLAN.md §8.2, §8.4, API.md §3
// POST games/{id}/settle-bet). BUKAN mekanisme baru — cuma preset yang
// memindahkan payer_id semua baris ke SATU orang di sisi yang kalah
// (pemain pertama menurut slot; sisanya nombok ke dia di luar app, sama
// cara v2 tidak pernah mencoba membagi utang taruhan sendiri).
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// handleSettleBet — POST /clubs/{clubId}/games/{id}/settle-bet.
func handleSettleBet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		gameID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}

		var notFound bool
		var problem string
		var affectedPayers map[uuid.UUID]bool
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			game, err := q.GetGame(ctx, gen.GetGameParams{ID: gameID, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			if !game.WinnerSide.Valid {
				problem = "Main ini belum ada skornya — isi skor dulu sebelum menyelesaikan taruhan kok."
				return nil
			}

			players, err := q.ListGamePlayersByGame(ctx, gameID)
			if err != nil {
				return err
			}
			losingSide := gen.GameSideA
			if game.WinnerSide.GameSide == gen.GameSideA {
				losingSide = gen.GameSideB
			}
			var target *uuid.UUID
			affectedPayers = map[uuid.UUID]bool{}
			for _, p := range players {
				affectedPayers[p.PayerID] = true
				if target == nil && p.Side == losingSide {
					id := p.UserID
					target = &id
				}
			}
			if target == nil {
				problem = "Sisi yang kalah tidak punya pemain — tidak ada yang bisa ditunjuk menanggung."
				return nil
			}
			affectedPayers[*target] = true

			updated, err := q.SetGamePlayersPayer(ctx, gen.SetGamePlayersPayerParams{GameID: gameID, ClubID: clubID, PayerID: *target})
			if err != nil {
				return err
			}
			if len(updated) == 0 {
				problem = "Semua baris main ini sudah lunas atau sedang disanggah — tidak ada yang bisa dipindah."
				return nil
			}

			dto := newGameDTO(game)
			for _, p := range players {
				dto.Players = append(dto.Players, newGamePlayerDTO(p))
			}
			if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindGameUpdated, clubID, dto)); err != nil {
				return err
			}
			for payerID := range affectedPayers {
				total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: payerID})
				if err != nil {
					return err
				}
				billData := map[string]any{"club_id": clubID, "user_id": payerID, "total_owed": total}
				if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, billData)); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyelesaikan taruhan kok.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Main tidak ditemukan.", nil)
			return
		}
		if problem != "" {
			writeError(w, CodeValidationFailed, problem, nil)
			return
		}

		dto, err := loadGameDTO(r.Context(), s, clubID, gameID)
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil data main.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}
