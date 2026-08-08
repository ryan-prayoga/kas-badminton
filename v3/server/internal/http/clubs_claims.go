package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type claimRequestDTO struct {
	ID          uuid.UUID  `json:"id"`
	RequesterID uuid.UUID  `json:"requester_id"`
	TargetUser  *uuid.UUID `json:"target_user,omitempty"`
	Status      string     `json:"status"`
	Note        *string    `json:"note,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func newClaimRequestDTO(c gen.ClaimRequest) claimRequestDTO {
	return claimRequestDTO{
		ID: c.ID, RequesterID: c.RequesterID, TargetUser: c.TargetUser,
		Status: string(c.Status), Note: textOrNil(c.Note), CreatedAt: tsOrZero(c.CreatedAt),
	}
}

type createClaimRequestBody struct {
	TargetUserID *string `json:"target_user_id"`
}

// handleCreateClaimRequest — POST /clubs/{clubId}/claim-requests. Dipasang
// di belakang RequireClubExists (BUKAN RequireClub — pemanggil belum
// anggota, §7.3). requester_id-nya diri sendiri, selalu — tidak ada jalan
// mengajukan klaim atas nama orang lain.
//
// CATATAN LINGKUP: menyetujui klaim di sini membuat requester jadi anggota
// klub; kalau target_user_id diisi (klaim akun bayangan lama), riwayat main
// milik akun bayangan itu BELUM dipindah otomatis ke requester — pemindahan
// data lintas tabel (game_players, dst) sengaja ditunda ke pekerjaan
// tersendiri yang diuji khusus untuk itu, bukan ditempel di sini secara
// tergesa.
func handleCreateClaimRequest(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}

		var req createClaimRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		var targetUser *uuid.UUID
		if req.TargetUserID != nil && *req.TargetUserID != "" {
			id, err := uuid.Parse(*req.TargetUserID)
			if err != nil {
				writeError(w, CodeValidationFailed, "target_user_id tidak valid.", nil)
				return
			}
			targetUser = &id
		}

		var claim gen.ClaimRequest
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			claim, err = q.CreateClaimRequest(ctx, gen.CreateClaimRequestParams{
				ClubID: clubID, RequesterID: userID, TargetUser: targetUser,
			})
			if err != nil {
				return err
			}
			return notifyVerifiersOfClaim(ctx, q, clubID, userID)
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengajukan permintaan gabung.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, newClaimRequestDTO(claim))
	}
}

// handleListPendingClaims — GET /clubs/{clubId}/claim-requests?status=pending
// (API.md §2), RequirePerm(VerifyClaim) — "verifikator", bukan
// ManageMembers (§7.4).
func handleListPendingClaims(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		var claims []gen.ClaimRequest
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			claims, err = q.ListPendingClaimRequests(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil antrean klaim.", nil)
			return
		}
		dtos := make([]claimRequestDTO, 0, len(claims))
		for _, c := range claims {
			dtos = append(dtos, newClaimRequestDTO(c))
		}
		writeJSON(w, http.StatusOK, dtos)
	}
}

type decideClaimBody struct {
	Note string `json:"note"`
}

func decideClaim(s *store.Store, status gen.ClaimStatus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		deciderID, _ := userIDFromContext(r.Context())
		claimID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Permintaan klaim tidak ditemukan.", nil)
			return
		}
		var req decideClaimBody
		_ = json.NewDecoder(r.Body).Decode(&req) // note opsional, body kosong tetap sah

		var claim gen.ClaimRequest
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			c, err := q.DecideClaimRequest(ctx, gen.DecideClaimRequestParams{
				ID: claimID, ClubID: clubID, Status: status, DecidedBy: &deciderID, Note: textOf(req.Note),
			})
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			claim = c
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal memutuskan permintaan klaim.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Permintaan klaim tidak ditemukan atau sudah diputuskan.", nil)
			return
		}

		if status == gen.ClaimStatusApproved {
			// Requester jadi anggota — role bawaan `member`, pengurus
			// menaikkan lewat PATCH .../members/{userId}/role kalau perlu.
			// Duplikat (sudah anggota) diabaikan, bukan galat.
			_ = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
				_, err := q.CreateMembership(ctx, gen.CreateMembershipParams{
					ClubID: clubID, UserID: claim.RequesterID, Role: gen.ClubRoleMember,
				})
				return err
			})
		}

		writeJSON(w, http.StatusOK, newClaimRequestDTO(claim))
	}
}

// notifyVerifiersOfClaim — "permintaan klaim masuk" (§10.1), dikirim ke
// SEMUA admin+verifikator aktif klub, bukan cuma satu orang — siapa pun
// yang lebih dulu buka app yang memutuskan.
func notifyVerifiersOfClaim(ctx context.Context, q *gen.Queries, clubID, requesterID uuid.UUID) error {
	club, err := q.GetClub(ctx, clubID)
	if err != nil {
		return err
	}
	verifiers, err := q.ListVerifiersByClub(ctx, clubID)
	if err != nil {
		return err
	}
	names, err := namesFor(ctx, q, []uuid.UUID{requesterID})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, verifierID := range verifiers {
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: verifierID, ClubID: &clubID, ClubTimezone: club.Timezone,
			Kind: domain.NotifClaimRequested, Now: now,
			Title: "Permintaan gabung baru",
			Body:  fmt.Sprintf("%s minta gabung %s — cek dan setujui.", names[requesterID], club.Name),
			URL:   "/klub",
		}); err != nil {
			return err
		}
	}
	return nil
}

// handleApproveClaim — POST /clubs/{clubId}/claim-requests/{id}/approve.
func handleApproveClaim(s *store.Store) http.HandlerFunc {
	return decideClaim(s, gen.ClaimStatusApproved)
}

// handleRejectClaim — POST /clubs/{clubId}/claim-requests/{id}/reject.
func handleRejectClaim(s *store.Store) http.HandlerFunc {
	return decideClaim(s, gen.ClaimStatusRejected)
}
