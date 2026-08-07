package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// ErrJoinTokenNotFound — token bukan club_links maupun invites yang aktif.
var ErrJoinTokenNotFound = errors.New("httpapi: token gabung tidak ditemukan/kedaluwarsa")

// resolveJoinToken — SATU token bisa datang dari dua sumber: club_links
// (QR tembok, §6.4) atau invites (undangan per-orang, §7.3 jalur B). Coba
// keduanya lewat fungsi SECURITY DEFINER (migrasi 00017/00018) — jangan
// query tabel langsung, RLS akan menolak sebelum club_id diketahui.
func resolveJoinToken(ctx context.Context, s *store.Store, token string) (uuid.UUID, error) {
	var clubID uuid.UUID
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		clubID, err = q.ClubIDForJoinToken(ctx, token)
		return err
	})
	if err == nil {
		return clubID, nil
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		clubID, err = q.ClubIDForInviteToken(ctx, token)
		return err
	})
	if err == nil {
		return clubID, nil
	}
	return uuid.UUID{}, ErrJoinTokenNotFound
}

type joinInfoDTO struct {
	Club      clubDTO            `json:"club"`
	Unclaimed []unclaimedUserDTO `json:"unclaimed"`
}

type unclaimedUserDTO struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
}

// handleJoinInfo — GET /join/{token}, PUBLIK (API.md §2, §6.4). Info klub +
// daftar nama belum-terklaim buat "pilih namanya dari daftar" — sengaja
// TANPA nomor telepon siapa pun (halaman ini belum minta OTP apa pun).
func handleJoinInfo(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		clubID, err := resolveJoinToken(r.Context(), s, token)
		if err != nil {
			writeError(w, CodeNotFound, "Tautan sudah tidak berlaku. Minta tautan/QR baru.", nil)
			return
		}

		var club gen.Club
		var unclaimed []gen.User
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}

			// scan_count cuma berarti buat token club_links (poster/QR
			// tembok) — kalau bukan sumbernya, IncrementClubLinkScanCount
			// dilewati diam-diam lewat notFound di bawah, bukan galat.
			if link, err := q.GetClubLinkByToken(ctx, token); err == nil {
				_ = q.IncrementClubLinkScanCount(ctx, link.ID)
			}

			unclaimed, err = q.SearchUnclaimedByClub(ctx, gen.SearchUnclaimedByClubParams{ClubID: clubID, Q: textOf("")})
			return err
		})
		if err != nil {
			writeError(w, CodeNotFound, "Klub tidak ditemukan.", nil)
			return
		}

		dto := joinInfoDTO{Club: newClubDTO(club), Unclaimed: make([]unclaimedUserDTO, 0, len(unclaimed))}
		for _, u := range unclaimed {
			dto.Unclaimed = append(dto.Unclaimed, unclaimedUserDTO{ID: u.ID, DisplayName: u.DisplayName})
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type joinRequestBody struct {
	Phone string `json:"phone"`
}

// handleJoinRequest — POST /join/{token}, PUBLIK. Kirim OTP purpose="claim"
// (§6.4 "nomor WA → OTP"). Verifikasinya lewat /auth/otp/verify yang sudah
// ada (F4/1) — sesi jadi, lanjut ke POST /clubs/{clubId}/claim-requests.
func handleJoinRequest(s *store.Store, notifier notify.Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		clubID, err := resolveJoinToken(r.Context(), s, token)
		if err != nil {
			writeError(w, CodeNotFound, "Tautan sudah tidak berlaku. Minta tautan/QR baru.", nil)
			return
		}
		_ = clubID // dipakai lewat POST /clubs/{clubId}/claim-requests sesudahnya, bukan di sini

		var req joinRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if err := auth.RequestOTP(r.Context(), s, notifier, req.Phone, "claim"); err != nil {
			writeOTPError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
	}
}
