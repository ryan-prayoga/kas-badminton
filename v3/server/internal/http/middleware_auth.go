package httpapi

import (
	"net/http"
	"strings"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// RequireAuth memvalidasi "Authorization: Bearer <token sesi>" (PLAN.md
// §7.2). Sesi dibuat lewat POST /api/v1/dev/login (F2, dev only) sampai
// F4 memasang alur OTP/passkey/PIN — validasinya sendiri sudah final.
func RequireAuth(s *store.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			sess, err := auth.Validate(r.Context(), s, token)
			if err != nil {
				writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
				return
			}
			next.ServeHTTP(w, r.WithContext(withUserID(r.Context(), sess.UserID, sess.ID)))
		})
	}
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimPrefix(h, prefix)
}
