// Taruhan barang (PLAN.md §8.4, API.md §3, DDL migrasi 00013). Ledger
// terpisah TANPA rupiah — tidak pernah menyentuh kas/deposit/tagihan.
// Terbuka buat anggota mana pun (bukan RequirePerm) karena santai
// ("2 Pocari"), bukan urusan uang klub.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type sideBetDTO struct {
	ID         uuid.UUID  `json:"id"`
	GameID     *uuid.UUID `json:"game_id,omitempty"`
	DebtorID   uuid.UUID  `json:"debtor_id"`
	CreditorID uuid.UUID  `json:"creditor_id"`
	Item       string     `json:"item"`
	Status     string     `json:"status"`
	SettledAt  *time.Time `json:"settled_at,omitempty"`
	CreatedBy  *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func newSideBetDTO(b gen.SideBet) sideBetDTO {
	dto := sideBetDTO{
		ID: b.ID, GameID: b.GameID, DebtorID: b.DebtorID, CreditorID: b.CreditorID,
		Item: b.Item, Status: string(b.Status), CreatedBy: b.CreatedBy, CreatedAt: tsOrZero(b.CreatedAt),
	}
	if b.SettledAt.Valid {
		v := b.SettledAt.Time
		dto.SettledAt = &v
	}
	return dto
}

type createSideBetRequest struct {
	GameID     *string `json:"game_id"`
	DebtorID   string  `json:"debtor_id"`
	CreditorID string  `json:"creditor_id"`
	Item       string  `json:"item"`
}

// handleCreateSideBet — POST /clubs/{clubId}/side-bets (API.md §3).
func handleCreateSideBet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var req createSideBetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		item := strings.TrimSpace(req.Item)
		if item == "" {
			writeError(w, CodeValidationFailed, "Isi taruhan wajib diisi (mis. \"2 Pocari\").", nil)
			return
		}
		debtorID, err := uuid.Parse(req.DebtorID)
		if err != nil {
			writeError(w, CodeValidationFailed, "debtor_id tidak valid.", nil)
			return
		}
		creditorID, err := uuid.Parse(req.CreditorID)
		if err != nil {
			writeError(w, CodeValidationFailed, "creditor_id tidak valid.", nil)
			return
		}
		if debtorID == creditorID {
			writeError(w, CodeValidationFailed, "Yang berutang dan yang ditunggu tidak boleh orang yang sama.", nil)
			return
		}
		var gameID *uuid.UUID
		if req.GameID != nil && *req.GameID != "" {
			id, err := uuid.Parse(*req.GameID)
			if err != nil {
				writeError(w, CodeValidationFailed, "game_id tidak valid.", nil)
				return
			}
			gameID = &id
		}

		var bet gen.SideBet
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			b, err := q.CreateSideBet(ctx, gen.CreateSideBetParams{
				ClubID: clubID, GameID: gameID, DebtorID: debtorID, CreditorID: creditorID,
				Item: item, CreatedBy: &userID,
			})
			if err != nil {
				return err
			}
			bet = b
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindSideBetUpdated, clubID, newSideBetDTO(b)))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencatat taruhan.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, newSideBetDTO(bet))
	}
}

// handleListSideBets — GET /clubs/{clubId}/side-bets?open=true (API.md §3).
func handleListSideBets(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		openOnly := r.URL.Query().Get("open") == "true"

		var rows []gen.SideBet
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListSideBetsByClub(ctx, gen.ListSideBetsByClubParams{
				ClubID: clubID, OpenOnly: pgtype.Bool{Bool: openOnly, Valid: true},
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar taruhan.", nil)
			return
		}
		items := make([]sideBetDTO, 0, len(rows))
		for _, b := range rows {
			items = append(items, newSideBetDTO(b))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

type patchSideBetRequest struct {
	Status string `json:"status"`
}

// handlePatchSideBet — PATCH /clubs/{clubId}/side-bets/{id} (API.md §3),
// tandai lunas/batal. HAK yang terlibat — debtor ATAU creditor (dua-duanya
// tahu urusannya sudah kelar/tidak jadi), bukan RequirePerm: taruhan
// receh antar teman bukan wewenang pengurus (§8.4 "tanpa rupiah").
func handlePatchSideBet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Taruhan tidak ditemukan.", nil)
			return
		}
		var req patchSideBetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.Status != "settled" && req.Status != "cancelled" {
			writeError(w, CodeValidationFailed, "status harus settled atau cancelled.", nil)
			return
		}

		var notFound, forbidden bool
		var bet gen.SideBet
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			current, err := q.GetSideBet(ctx, gen.GetSideBetParams{ID: id, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			if current.DebtorID != callerID && current.CreditorID != callerID {
				forbidden = true
				return nil
			}
			b, err := q.UpdateSideBetStatus(ctx, gen.UpdateSideBetStatusParams{ID: id, ClubID: clubID, Status: gen.BetStatus(req.Status)})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			bet = b
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindSideBetUpdated, clubID, newSideBetDTO(b)))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah status taruhan.", nil)
			return
		}
		if forbidden {
			writeError(w, CodeInsufficientPermission, "Cuma yang berutang atau yang ditunggu yang bisa mengubah taruhan ini.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Taruhan tidak ditemukan atau sudah diselesaikan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newSideBetDTO(bet))
	}
}
