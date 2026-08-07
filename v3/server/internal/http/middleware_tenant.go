package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

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
				return nil
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal memeriksa keanggotaan klub.", nil)
				return
			}
			if !found {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}

			next.ServeHTTP(w, r.WithContext(withClub(r.Context(), clubID, membership.Role)))
		})
	}
}
