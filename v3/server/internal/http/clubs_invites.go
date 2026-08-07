package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// inviteTTL — masa berlaku tautan undangan sekali pakai (§7.3 jalur B).
// Tidak ada angka eksplisit di §17 buat ini; 7 hari cukup longgar buat
// orang benar-benar membuka WA-nya, tanpa menggantung selamanya.
const inviteTTL = 7 * 24 * time.Hour

type createInviteRequest struct {
	Phone        string  `json:"phone"`
	TargetUserID *string `json:"target_user_id"`
}

type inviteDTO struct {
	ID        uuid.UUID `json:"id"`
	Token     string    `json:"token"`
	Phone     *string   `json:"phone,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
}

// handleCreateInvite — POST /clubs/{clubId}/invites (API.md §2, §7.3 jalur
// B), RequirePerm(ManageMembers). Kirim tautan sekali pakai via WA — token
// yang sama dibaca ulang di GET/POST /join/{token} (join.go
// resolveJoinToken, mencoba club_links dulu baru invites).
func handleCreateInvite(s *store.Store, notifier notify.Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		userID, _ := userIDFromContext(r.Context())

		var req createInviteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if !auth.PhoneRe.MatchString(req.Phone) {
			writeError(w, CodeValidationFailed, "Nomor WA harus format internasional, mis. +6281234567890.", nil)
			return
		}
		var targetUser *uuid.UUID
		if req.TargetUserID != nil && *req.TargetUserID != "" {
			id, err := uuid.Parse(*req.TargetUserID)
			if err != nil {
				writeError(w, CodeValidationFailed, "target_user_id tidak valid.", nil)
				return
			}
			targetUser = &id
		}

		token, err := newLinkToken()
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat token undangan.", nil)
			return
		}
		expiresAt := time.Now().Add(inviteTTL)

		var invite gen.Invite
		var clubName string
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			club, err := q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			clubName = club.Name

			invite, err = q.CreateInvite(ctx, gen.CreateInviteParams{
				ClubID: clubID, Token: token, Phone: textOf(req.Phone), TargetUser: targetUser,
				CreatedBy: &userID, ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat undangan.", nil)
			return
		}

		_ = notifier.Send(r.Context(), notify.Message{
			Phone: req.Phone,
			Body:  "Kamu diundang gabung " + clubName + " di Kok Badminton. Buka: https://kaskok.my.id/join/" + token,
		})

		writeJSON(w, http.StatusCreated, inviteDTO{ID: invite.ID, Token: invite.Token, Phone: textOrNil(invite.Phone), ExpiresAt: expiresAt})
	}
}
