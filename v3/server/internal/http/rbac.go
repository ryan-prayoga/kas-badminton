package httpapi

import (
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// requireRole adalah RBAC RINGAN: cek peran yang sudah ditaruh RequireClub
// di context, tanpa fallback/masa-berlaku/saklar per klub (itu "resolusi
// izin" lengkap yang jadi jatah F4 — PLAN.md §14 F4). Cukup buat menahan
// endpoint games F2 di tangan yang wajar (pencatat/bendahara/admin),
// bukan sistem izin final.
func requireRole(w http.ResponseWriter, r *http.Request, allowed ...gen.ClubRole) bool {
	role, ok := roleFromContext(r.Context())
	if !ok {
		writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
		return false
	}
	for _, a := range allowed {
		if role == a {
			return true
		}
	}
	writeError(w, CodeInsufficientPermission, "Kamu tidak punya izin buat aksi ini di klub.", nil)
	return false
}
