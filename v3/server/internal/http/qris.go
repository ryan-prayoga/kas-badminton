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
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/qris"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// QRIS statis tersimpan per klub + QR dinamis sekali pakai (PLAN.md §9.6,
// API.md §4 "Kas & QRIS"). Decode dari FOTO terjadi di BROWSER
// (BarcodeDetector/lib JS) — server di sini cuma menerima teks payload
// yang sudah terdekode, tidak pernah gambar (lihat komentar package qris).

// qrisDynamicTTL — berapa lama satu QR dinamis berlaku SEBELUM klien wajib
// membuatnya ulang (§9.6 "selalu dibuat ulang saat dialog dibuka, jangan
// pernah di-cache"). EMVCo tidak punya tag TTL baku yang didukung luas
// aplikasi bank, jadi kedaluwarsanya murni catatan server (qris_dynamic_
// events.expires_at) — dialog yang menegakkannya dgn membuat ulang, bukan
// payload QR itu sendiri.
const qrisDynamicTTL = 5 * time.Minute

type qrisDTO struct {
	MerchantQris *string `json:"merchant_qris"`
	Version      int64   `json:"version"`
}

// handleGetQris — GET /clubs/{clubId}/qris. Siapa pun anggota klub boleh
// baca (dipakai layar bayar, §9.6) — bukan ManageMoney, beda dari PUT.
func handleGetQris(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		var club gen.Club
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil QRIS.", nil)
			return
		}
		writeJSON(w, http.StatusOK, qrisDTO{MerchantQris: textOrNil(club.MerchantQris), Version: club.Version})
	}
}

type putQrisRequest struct {
	Payload string `json:"payload"`
}

// handlePutQris — PUT /clubs/{clubId}/qris (perm.ManageMoney di router).
// "payload" = teks QRIS statis yang SUDAH terdekode klien dari foto —
// lihat komentar paket. Ditolak kalau bukan QRIS statis valid (§9.6:
// simpan apa adanya, jangan pernah QR dinamis kedaluwarsa tersangkut jadi
// QRIS permanen klub).
func handlePutQris(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		version, ok := requireIfMatch(r)
		if !ok {
			writeError(w, CodeValidationFailed, "Header If-Match: <version> wajib diisi.", nil)
			return
		}
		var req putQrisRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if err := qris.ValidateStatic(req.Payload); err != nil {
			writeError(w, CodeValidationFailed, "QRIS tidak valid: "+err.Error(), nil)
			return
		}

		var club gen.Club
		conflict := false
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			c, err := q.UpdateClubMerchantQris(ctx, gen.UpdateClubMerchantQrisParams{
				ID: clubID, MerchantQris: textOf(req.Payload), Version: version,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					conflict = true
					return nil
				}
				return err
			}
			club = c
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menyimpan QRIS.", nil)
			return
		}
		if conflict {
			current, err := currentClub(r.Context(), s, clubID)
			if err != nil {
				writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeVersionConflict, "QRIS klub ini sudah diubah orang lain. Cek versi terbaru dulu.", qrisDTO{MerchantQris: textOrNil(current.MerchantQris), Version: current.Version})
			return
		}
		writeJSON(w, http.StatusOK, qrisDTO{MerchantQris: textOrNil(club.MerchantQris), Version: club.Version})
	}
}

func currentClub(ctx context.Context, s *store.Store, clubID uuid.UUID) (gen.Club, error) {
	var club gen.Club
	err := s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		var err error
		club, err = q.GetClub(ctx, clubID)
		return err
	})
	return club, err
}

type dynamicQrisRequest struct {
	Amount int64 `json:"amount"`
}

type dynamicQrisDTO struct {
	ID        uuid.UUID `json:"id"`
	Payload   string    `json:"payload"`
	ExpiresAt string    `json:"expires_at"`
}

// handleCreateDynamicQris — POST /clubs/{clubId}/qris/dynamic {amount}.
// Anggota mana pun (bukan ManageMoney) — dipakai pemain sendiri saat
// membayar tagihannya, "isi nominal otomatis" (§9.6).
func handleCreateDynamicQris(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		var req dynamicQrisRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
			writeError(w, CodeValidationFailed, "amount wajib diisi dan lebih dari 0.", nil)
			return
		}

		var event gen.QrisDynamicEvent
		var payload string
		noQris := false
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			club, err := q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			if !club.MerchantQris.Valid || club.MerchantQris.String == "" {
				noQris = true
				return nil
			}
			payload, err = qris.ToDynamic(club.MerchantQris.String, req.Amount)
			if err != nil {
				return errValidation("QRIS klub tidak valid, hubungi bendahara: " + err.Error())
			}
			event, err = q.CreateQrisDynamicEvent(ctx, gen.CreateQrisDynamicEventParams{
				ClubID: clubID, Amount: req.Amount, CreatedBy: &userID,
				ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(qrisDynamicTTL), Valid: true},
			})
			return err
		})
		if err != nil {
			writeWalletError(w, err, "Gagal membuat QR dinamis.")
			return
		}
		if noQris {
			writeError(w, CodeValidationFailed, "Klub ini belum punya QRIS tersimpan. Minta bendahara memasangnya dulu.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, dynamicQrisDTO{
			ID: event.ID, Payload: payload, ExpiresAt: event.ExpiresAt.Time.Format(rfc3339),
		})
	}
}

// handleReportQrisDynamicRejected — POST
// /clubs/{clubId}/qris/dynamic/{id}/report-rejected (§9.6 "QR-nya
// ditolak" — kembali ke statis DAN mencatat kejadiannya). Anggota mana
// pun boleh lapor; dua laporan pada QR yang sama tidak menimpa yang
// pertama (ReportQrisDynamicRejected, qris.sql).
func handleReportQrisDynamicRejected(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		eventID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "QR dinamis tidak ditemukan.", nil)
			return
		}
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			_, err := q.ReportQrisDynamicRejected(ctx, gen.ReportQrisDynamicRejectedParams{ID: eventID, ClubID: clubID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencatat laporan.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "QR dinamis tidak ditemukan atau sudah pernah dilaporkan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
