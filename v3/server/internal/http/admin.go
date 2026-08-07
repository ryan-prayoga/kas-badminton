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

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type adminClubDTO struct {
	ID          uuid.UUID `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	MemberCount int64     `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

// handleAdminListClubs — GET /admin/clubs (API.md §7): daftar klub + metrik
// agregat. SENGAJA tidak ada padanan "lihat isi klub X" di permukaan admin
// (§6.5) — cuma nama/slug/status/jumlah anggota, tidak ada tagihan/riwayat.
func handleAdminListClubs(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var rows []gen.ListClubsWithMemberCountRow
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListClubsWithMemberCount(ctx)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar klub.", nil)
			return
		}
		dtos := make([]adminClubDTO, 0, len(rows))
		for _, c := range rows {
			dtos = append(dtos, adminClubDTO{
				ID: c.ID, Slug: c.Slug, Name: c.Name, Status: string(c.Status),
				MemberCount: c.MemberCount, CreatedAt: tsOrZero(c.CreatedAt),
			})
		}
		writeJSON(w, http.StatusOK, dtos)
	}
}

// handleAdminSuspendClub — POST /admin/clubs/{id}/suspend (API.md §7,
// PLAN.md §12.2: "tidak pernah dihapus otomatis — data ditahan sampai
// persoalannya selesai").
func handleAdminSuspendClub(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
			return
		}

		var club gen.Club
		notFound := false
		err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			c, err := q.SuspendClub(ctx, clubID)
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			club = c
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menangguhkan klub.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newClubDTO(club))
	}
}

// defaultClubQuotas — bawaan longgar (§12.1). Sama pola defaultClubSettings
// (clubs.go): satu struct jadi sumber kebenaran shape JSON, dipakai baca
// DAN tulis.
type defaultClubQuotas struct {
	FotoMaxMB      int `json:"foto_max_mb"`
	AnggotaPerKlub int `json:"anggota_per_klub"`
	PosterAktif    int `json:"poster_aktif"`
	WaPesanPerHari int `json:"wa_pesan_per_hari"`
}

func defaultQuotasJSON() []byte {
	b, _ := json.Marshal(defaultClubQuotas{
		FotoMaxMB: 8, AnggotaPerKlub: 500, PosterAktif: 10, WaPesanPerHari: 50,
	})
	return b
}

type patchQuotasRequest struct {
	FotoMaxMB      *int `json:"foto_max_mb"`
	AnggotaPerKlub *int `json:"anggota_per_klub"`
	PosterAktif    *int `json:"poster_aktif"`
	WaPesanPerHari *int `json:"wa_pesan_per_hari"`
}

// handleAdminUpdateQuotas — POST /admin/clubs/{id}/quotas (API.md §7, §12.1:
// "hanya superadmin, per permintaan" — terutama kuota pesan WA, nomor bot
// dipakai bersama semua klub).
func handleAdminUpdateQuotas(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
			return
		}
		var req patchQuotasRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}

		var updated gen.Club
		notFound := false
		err = s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			current, err := q.GetClub(ctx, clubID)
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			if err != nil {
				return err
			}
			quotas := current.Quotas
			if len(quotas) == 0 {
				quotas = defaultQuotasJSON()
			}
			var cq defaultClubQuotas
			_ = json.Unmarshal(quotas, &cq)
			if req.FotoMaxMB != nil {
				cq.FotoMaxMB = *req.FotoMaxMB
			}
			if req.AnggotaPerKlub != nil {
				cq.AnggotaPerKlub = *req.AnggotaPerKlub
			}
			if req.PosterAktif != nil {
				cq.PosterAktif = *req.PosterAktif
			}
			if req.WaPesanPerHari != nil {
				cq.WaPesanPerHari = *req.WaPesanPerHari
			}
			merged, err := json.Marshal(cq)
			if err != nil {
				return err
			}
			updated, err = q.UpdateClubQuotas(ctx, gen.UpdateClubQuotasParams{ID: clubID, Quotas: merged})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah kuota.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newClubDTO(updated))
	}
}

// handleAdminWaHealth — GET /admin/wa/health (API.md §7, PLAN.md §12
// "Pemantauan sesi WA"). Lapor status Notifier yang SUNGGUHAN dipasang —
// notify.Fake (dev/CI sampai F4/6) melapor jujur "tidak pernah terhubung",
// bukan "ok" palsu.
func handleAdminWaHealth(notifier notify.Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hc, ok := notifier.(notify.HealthChecker)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "detail": "notifier tidak mendukung pemeriksaan kesehatan"})
			return
		}
		healthy, detail := hc.Health(r.Context())
		writeJSON(w, http.StatusOK, map[string]any{"ok": healthy, "detail": detail})
	}
}

// handleAdminQueueDepth — GET /admin/notifications/queue-depth (API.md §7,
// PLAN.md §12). Antrean SUNGGUHAN dari tabel notifications — kosong sampai
// F8 (router notifikasi) benar-benar menulis ke situ; jujur 0, bukan
// dikarang.
func handleAdminQueueDepth(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var total int64
		var byChannel []gen.CountQueuedNotificationsByChannelRow
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			var err error
			total, err = q.CountQueuedNotifications(ctx)
			if err != nil {
				return err
			}
			byChannel, err = q.CountQueuedNotificationsByChannel(ctx)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil kedalaman antrean.", nil)
			return
		}
		perChannel := make(map[string]int64, len(byChannel))
		for _, c := range byChannel {
			perChannel[string(c.Channel)] = c.N
		}
		writeJSON(w, http.StatusOK, map[string]any{"total": total, "by_channel": perChannel})
	}
}
