package httpapi

import (
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
)

// RequirePerm menahan endpoint di belakang satu izin (PLAN.md §7.4, §14 F4
// "selesai kalau": pencatat ditolak saat menyentuh endpoint uang). Ganti
// requireRole (RBAC ringan F2, sudah dihapus) — izinnya sendiri sudah
// dihitung sekali oleh RequireClub (perm.Resolve, lihat middleware_tenant.go)
// jadi di sini tinggal baca map, bukan query ulang ke DB.
func RequirePerm(p perm.Permission) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			granted, ok := permFromContext(r.Context())
			if !ok {
				// RequirePerm dipasang tanpa RequireClub sebelumnya — bug
				// pemasangan rute, bukan masalah pengguna.
				writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
				return
			}
			if !perm.Has(granted, p) {
				writeError(w, CodeInsufficientPermission, "Kamu tidak punya izin buat aksi ini di klub.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
