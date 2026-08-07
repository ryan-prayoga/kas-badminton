package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$`)

// defaultClubSettings — nilai bawaan saklar per klub (PLAN.md §7.4, §17;
// DDL.sql baris 74-86 daftar kuncinya). Diisi lewat kode saat klub dibuat,
// bukan DEFAULT SQL, supaya perubahannya terlihat di riwayat kode
// (catatan pengeksekusi DDL.sql §4).
type defaultClubSettings struct {
	SiapaBolehCatat   string `json:"siapa_boleh_catat"`
	WajibVerifikasi   bool   `json:"wajib_verifikasi"`
	HalamanPublik     bool   `json:"halaman_publik"`
	TransparansiKas   bool   `json:"transparansi_kas"`
	HargaDefault      int64  `json:"harga_default"`
	FormatMainDefault string `json:"format_main_default"`
	TunggakanHari     int    `json:"tunggakan_hari"`
	TunggakanMinimal  int64  `json:"tunggakan_minimal"`
	TunggakanJedaHari int    `json:"tunggakan_jeda_hari"`
	PengingatWa       bool   `json:"pengingat_wa"`
}

func defaultSettingsJSON() []byte {
	b, _ := json.Marshal(defaultClubSettings{
		SiapaBolehCatat:   "semua_anggota",
		WajibVerifikasi:   false,
		HalamanPublik:     false,
		TransparansiKas:   true,
		HargaDefault:      0,
		FormatMainDefault: "ganda",
		TunggakanHari:     14,
		TunggakanMinimal:  50000,
		TunggakanJedaHari: 7,
		PengingatWa:       false,
	})
	return b
}

type createClubRequest struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
}

// handleCreateClub — POST /api/v1/clubs (API.md §2). Siapa saja yang
// punya akun bisa bikin klub; pembuatnya otomatis admin (§6.6).
func handleCreateClub(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}

		var req createClubRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
		req.Name = strings.TrimSpace(req.Name)
		if req.Timezone == "" {
			req.Timezone = "Asia/Jakarta"
		}
		if !slugRe.MatchString(req.Slug) {
			writeError(w, CodeValidationFailed, "Alamat klub cuma boleh huruf kecil, angka, dan tanda hubung.", nil)
			return
		}
		if req.Name == "" {
			writeError(w, CodeValidationFailed, "Nama klub belum diisi.", nil)
			return
		}

		clubID := uuid.New()
		var club gen.Club
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.CreateClub(ctx, gen.CreateClubParams{
				ID:        clubID,
				Slug:      req.Slug,
				Name:      req.Name,
				Timezone:  req.Timezone,
				Settings:  defaultSettingsJSON(),
				Quotas:    defaultQuotasJSON(),
				CreatedBy: &userID,
			})
			if err != nil {
				return err
			}
			_, err = q.CreateMembership(ctx, gen.CreateMembershipParams{
				ClubID: clubID,
				UserID: userID,
				Role:   gen.ClubRoleAdmin,
			})
			return err
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				writeError(w, CodeValidationFailed, "Alamat klub itu sudah dipakai.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal membuat klub.", nil)
			return
		}

		writeJSON(w, http.StatusCreated, newClubDTO(club))
	}
}

// handleGetClub — GET /api/v1/clubs/{clubId}. RequireClub sudah
// memverifikasi keanggotaan sebelum ini jalan.
func handleGetClub(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var club gen.Club
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			return err
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal mengambil data klub.", nil)
			return
		}

		writeJSON(w, http.StatusOK, newClubDTO(club))
	}
}
