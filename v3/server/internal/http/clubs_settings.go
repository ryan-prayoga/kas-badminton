package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// patchClubSettingsRequest — semua field opsional (pointer), field yang
// tidak dikirim TIDAK berubah (PATCH sungguhan, bukan PUT). Bentuknya
// sengaja sama dengan defaultClubSettings (clubs.go) — satu sumber
// kebenaran shape settings (lihat komentar UpdateClubSettings di
// clubs_settings.sql).
type patchClubSettingsRequest struct {
	SiapaBolehCatat   *string `json:"siapa_boleh_catat"`
	WajibVerifikasi   *bool   `json:"wajib_verifikasi"`
	HalamanPublik     *bool   `json:"halaman_publik"`
	TransparansiKas   *bool   `json:"transparansi_kas"`
	HargaDefault      *int64  `json:"harga_default"`
	FormatMainDefault *string `json:"format_main_default"`
	TunggakanHari     *int    `json:"tunggakan_hari"`
	TunggakanMinimal  *int64  `json:"tunggakan_minimal"`
	TunggakanJedaHari *int    `json:"tunggakan_jeda_hari"`
	PengingatWa       *bool   `json:"pengingat_wa"`
}

var validSiapaBolehCatat = map[string]bool{"semua_anggota": true, "hanya_pengurus": true}
var validFormatMain = map[string]bool{"single": true, "ganda": true, "rotasi": true}

// handlePatchClubSettings — PATCH /clubs/{clubId}/settings (API.md §2),
// RequirePerm(ManageMembers). If-Match wajib (invarian §3.4, pola sama
// handleUpdateGame).
func handlePatchClubSettings(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		version, ok := requireIfMatch(r)
		if !ok {
			writeError(w, CodeValidationFailed, "Header If-Match: <version> wajib diisi.", nil)
			return
		}
		var req patchClubSettingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.SiapaBolehCatat != nil && !validSiapaBolehCatat[*req.SiapaBolehCatat] {
			writeError(w, CodeValidationFailed, "siapa_boleh_catat harus semua_anggota atau hanya_pengurus.", nil)
			return
		}
		if req.FormatMainDefault != nil && !validFormatMain[*req.FormatMainDefault] {
			writeError(w, CodeValidationFailed, "format_main_default harus single, ganda, atau rotasi.", nil)
			return
		}

		var updated gen.Club
		conflict := false
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			current, err := q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			var cs defaultClubSettings
			_ = json.Unmarshal(current.Settings, &cs)
			applyClubSettingsPatch(&cs, req)
			merged, err := json.Marshal(cs)
			if err != nil {
				return err
			}

			u, err := q.UpdateClubSettings(ctx, gen.UpdateClubSettingsParams{ID: clubID, Settings: merged, Version: version})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					conflict = true
					return nil
				}
				return err
			}
			updated = u
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengubah pengaturan klub.", nil)
			return
		}
		if conflict {
			var current gen.Club
			err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
				var err error
				current, err = q.GetClub(ctx, clubID)
				return err
			})
			if err != nil {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeVersionConflict, "Pengaturan klub ini sudah diubah orang lain. Cek versi terbaru dulu.", newClubDTO(current))
			return
		}

		writeJSON(w, http.StatusOK, newClubDTO(updated))
	}
}

func applyClubSettingsPatch(cs *defaultClubSettings, p patchClubSettingsRequest) {
	if p.SiapaBolehCatat != nil {
		cs.SiapaBolehCatat = *p.SiapaBolehCatat
	}
	if p.WajibVerifikasi != nil {
		cs.WajibVerifikasi = *p.WajibVerifikasi
	}
	if p.HalamanPublik != nil {
		cs.HalamanPublik = *p.HalamanPublik
	}
	if p.TransparansiKas != nil {
		cs.TransparansiKas = *p.TransparansiKas
	}
	if p.HargaDefault != nil {
		cs.HargaDefault = *p.HargaDefault
	}
	if p.FormatMainDefault != nil {
		cs.FormatMainDefault = *p.FormatMainDefault
	}
	if p.TunggakanHari != nil {
		cs.TunggakanHari = *p.TunggakanHari
	}
	if p.TunggakanMinimal != nil {
		cs.TunggakanMinimal = *p.TunggakanMinimal
	}
	if p.TunggakanJedaHari != nil {
		cs.TunggakanJedaHari = *p.TunggakanJedaHari
	}
	if p.PengingatWa != nil {
		cs.PengingatWa = *p.PengingatWa
	}
}
