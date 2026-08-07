package httpapi

import (
	"context"
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// RequireSuperadmin — gerbang /admin/* (API.md §7, PLAN.md §6.5). platform_admins
// TIDAK ber-RLS (lintas klub by design), jadi lewat WithinTx biasa.
// Sengaja balas 404 (bukan 403) — pola sama RequireClub, supaya orang biasa
// bahkan tidak tahu ada permukaan admin.
func RequireSuperadmin(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := userIDFromContext(r.Context())
			if !ok {
				writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
				return
			}

			var isAdmin bool
			err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
				var err error
				isAdmin, err = q.IsSuperadmin(ctx, userID)
				return err
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal memeriksa akses.", nil)
				return
			}
			if !isAdmin {
				writeError(w, CodeNotFound, "Halaman tidak ditemukan.", nil)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
