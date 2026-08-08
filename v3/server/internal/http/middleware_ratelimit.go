package httpapi

import (
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/ratelimit"
)

// RateLimitByIP — lapisan PERTAMA rate limit (PLAN.md §12), dipasang
// paling luar di /api/v1 (router.go) supaya menjangkau permintaan TANPA
// sesi juga (/join, /auth/otp/request, halaman publik F9/1) — di situlah
// IP-based paling perlu, karena tidak ada userID buat digantung.
// middleware.RealIP (cmd/api/main.go, dipasang SEBELUM router ini)
// sudah menormalkan r.RemoteAddr jadi IP klien asli di belakang reverse
// proxy, jadi dipakai apa adanya sebagai key di sini.
func RateLimitByIP(l *ratelimit.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow(r.RemoteAddr) {
				writeError(w, CodeRateLimited, "Kebanyakan percobaan dari alamat ini. Coba lagi sebentar lagi.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
