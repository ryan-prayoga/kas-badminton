package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// RequireClub adalah lapisan kedua isolasi tenant (PLAN.md §6.2 — lapisan
// pertama middleware ini sendiri sebelum query jalan, ketiga RLS di DB).
// Menetapkan klub aktif dari {clubId} di path, menolak SEBELUM query apa
// pun kalau pemanggil bukan anggota — dan sengaja balas 404, bukan 403,
// supaya bukan-anggota tidak tahu klub itu ada.
func RequireClub(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := userIDFromContext(r.Context())
			if !ok {
				writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
				return
			}

			clubID, err := uuid.Parse(chi.URLParam(r, "clubId"))
			if err != nil {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}

			var membership gen.Membership
			var club gen.Club
			found := false
			err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
				m, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: userID})
				if err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return nil
					}
					return err
				}
				membership = m
				found = true

				club, err = q.GetClub(ctx, clubID)
				return err
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal memeriksa keanggotaan klub.", nil)
				return
			}
			if !found {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}

			granted := perm.Resolve(membership.Role, roleExpiresAtPtr(membership), siapaBolehCatat(club), time.Now())
			next.ServeHTTP(w, r.WithContext(withClub(r.Context(), clubID, membership.Role, granted)))
		})
	}
}

// RequireClubExists — versi ringan RequireClub buat POST
// /clubs/{clubId}/claim-requests (§7.3): pemanggil BELUM anggota klub itu
// (justru sedang meminta jadi anggota), jadi cek keanggotaan lewat
// RequireClub biasa akan salah — selalu 404. Cukup pastikan klubnya
// sungguhan ada & belum dihapus, isi context clubID TANPA role/izin (rute
// ini tidak dipasangi RequirePerm).
func RequireClubExists(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clubID, err := uuid.Parse(chi.URLParam(r, "clubId"))
			if err != nil {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}
			found := false
			err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
				_, err := q.GetClub(ctx, clubID)
				if errors.Is(err, pgx.ErrNoRows) {
					return nil
				}
				found = err == nil
				return nil
			})
			if err != nil || !found {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}
			next.ServeHTTP(w, r.WithContext(withClub(r.Context(), clubID, gen.ClubRoleMember, map[perm.Permission]bool{})))
		})
	}
}

func roleExpiresAtPtr(m gen.Membership) *time.Time {
	if !m.RoleExpiresAt.Valid {
		return nil
	}
	t := m.RoleExpiresAt.Time
	return &t
}

// siapaBolehCatat baca saklar clubs.settings.siapa_boleh_catat (PLAN.md
// §7.4). clubs.settings SELALU diisi lengkap saat klub dibuat
// (defaultSettingsJSON di clubs.go), jadi unmarshal parsial ke struct yang
// sama itu aman — field yang memang tidak ada di JSON cuma kebagian nol.
func siapaBolehCatat(c gen.Club) perm.SiapaBolehCatat {
	var s struct {
		SiapaBolehCatat string `json:"siapa_boleh_catat"`
	}
	_ = json.Unmarshal(c.Settings, &s)
	return perm.SiapaBolehCatat(s.SiapaBolehCatat)
}
