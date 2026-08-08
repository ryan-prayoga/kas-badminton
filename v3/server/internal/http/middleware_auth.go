package httpapi

import (
	"net/http"
	"strings"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/ratelimit"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// RequireAuth memvalidasi "Authorization: Bearer <token sesi>" (PLAN.md
// §7.2). Sesi dibuat lewat POST /api/v1/dev/login (F2, dev only) sampai
// F4 memasang alur OTP/passkey/PIN — validasinya sendiri sudah final.
//
// userLimiter — lapisan KEDUA rate limit (PLAN.md §12, F9/3), per userID
// bukan per IP: satu pengguna sah TAPI ngebug (retry membabi buta,
// beberapa tab) tidak boleh membebani lebih dari jatahnya sendiri,
// terlepas dari limiter IP di router.go yang menjaga tetangganya di
// jaringan sama. Dicek di SINI (bukan middleware terpisah) karena
// userID baru ada setelah sesi tervalidasi — satu-satunya titik yang
// tahu keduanya sekaligus tanpa query ganda.
func RequireAuth(s *store.Store, userLimiter *ratelimit.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			sess, err := auth.Validate(r.Context(), s, token)
			if err != nil {
				writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
				return
			}
			if userLimiter != nil && !userLimiter.Allow(sess.UserID.String()) {
				writeError(w, CodeRateLimited, "Kebanyakan permintaan dari akun ini. Coba lagi sebentar lagi.", nil)
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
