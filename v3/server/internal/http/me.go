package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type meMembershipDTO struct {
	ClubID        uuid.UUID  `json:"club_id"`
	ClubSlug      string     `json:"club_slug"`
	ClubName      string     `json:"club_name"`
	Role          string     `json:"role"`
	RoleExpiresAt *time.Time `json:"role_expires_at,omitempty"`
	AutoDeduct    bool       `json:"auto_deduct"`
}

type meDTO struct {
	ID          uuid.UUID         `json:"id"`
	Username    *string           `json:"username,omitempty"`
	DisplayName string            `json:"display_name"`
	Phone       *string           `json:"phone,omitempty"`
	Memberships []meMembershipDTO `json:"memberships"`
}

// handleGetMe — GET /me (API.md §1). Lintas klub, jadi TIDAK lewat
// RequireClub/WithClub — pakai store.WithUser (migrasi 00021) yang cuma
// nyalain app.user_id, bukan app.club_id. Ini satu-satunya endpoint yang
// tahu "klub apa saja yang aku ikuti" tanpa klien menyebutkan clubId lebih
// dulu (dipakai klien buat nentuin klub aktif / tampilkan switcher /
// layar "belum punya klub" — PLAN.md §14 F5).
func handleGetMe(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())

		var user gen.User
		var rows []gen.ListMembershipsWithClubByUserRow
		err := s.WithUser(r.Context(), userID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			user, err = q.GetUser(ctx, userID)
			if err != nil {
				return err
			}
			rows, err = q.ListMembershipsWithClubByUser(ctx, userID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil profil.", nil)
			return
		}

		memberships := make([]meMembershipDTO, 0, len(rows))
		for _, m := range rows {
			dto := meMembershipDTO{
				ClubID:     m.ClubID,
				ClubSlug:   m.ClubSlug,
				ClubName:   m.ClubName,
				Role:       string(m.Role),
				AutoDeduct: m.AutoDeduct,
			}
			if m.RoleExpiresAt.Valid {
				t := m.RoleExpiresAt.Time
				dto.RoleExpiresAt = &t
			}
			memberships = append(memberships, dto)
		}

		writeJSON(w, http.StatusOK, meDTO{
			ID:          user.ID,
			Username:    textOrNil(user.Username),
			DisplayName: user.DisplayName,
			Phone:       textOrNil(user.Phone),
			Memberships: memberships,
		})
	}
}
