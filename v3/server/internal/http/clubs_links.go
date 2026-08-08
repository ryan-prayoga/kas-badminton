package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/poster"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// publicBaseURL — domain publik app (PLAN.md §2: "kaskok.my.id"). Dipakai
// bareng poster + undangan (clubs_invites.go) supaya tidak ada dua sumber
// kebenaran alamat.
const publicBaseURL = "https://kaskok.my.id"

// newLinkToken — 24 byte acak, pola sama auth.NewToken (token sesi) supaya
// tidak bisa ditebak (§6.4: "QR di tembok itu publik — perlakukan begitu").
func newLinkToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

type clubLinkDTO struct {
	ID        uuid.UUID  `json:"id"`
	Purpose   string     `json:"purpose"`
	Token     string     `json:"token"`
	Label     *string    `json:"label,omitempty"`
	Active    bool       `json:"active"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	ScanCount int64      `json:"scan_count"`
	CreatedAt time.Time  `json:"created_at"`
}

func newClubLinkDTO(l gen.ClubLink) clubLinkDTO {
	dto := clubLinkDTO{
		ID: l.ID, Purpose: string(l.Purpose), Token: l.Token,
		Label: textOrNil(l.Label), Active: l.Active, ScanCount: l.ScanCount,
		CreatedAt: tsOrZero(l.CreatedAt),
	}
	if l.ExpiresAt.Valid {
		t := l.ExpiresAt.Time
		dto.ExpiresAt = &t
	}
	return dto
}

type createLinkRequest struct {
	Purpose   string     `json:"purpose"`
	Label     string     `json:"label"`
	ExpiresAt *time.Time `json:"expires_at"`
}

var validLinkPurpose = map[string]gen.LinkPurpose{"join": gen.LinkPurposeJoin, "poster": gen.LinkPurposePoster}

// handleCreateClubLink — POST /clubs/{clubId}/links (API.md §2, §6.4),
// RequirePerm(ManageMembers).
func handleCreateClubLink(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		userID, _ := userIDFromContext(r.Context())

		var req createLinkRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		purpose, ok := validLinkPurpose[req.Purpose]
		if !ok {
			purpose = gen.LinkPurposeJoin
		}
		token, err := newLinkToken()
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat token tautan.", nil)
			return
		}
		var expiresAt pgtype.Timestamptz
		if req.ExpiresAt != nil {
			expiresAt = pgtype.Timestamptz{Time: *req.ExpiresAt, Valid: true}
		}

		var link gen.ClubLink
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			if purpose == gen.LinkPurposePoster {
				club, err := q.GetClub(ctx, clubID)
				if err != nil {
					return err
				}
				if err := checkPosterQuota(ctx, q, club); err != nil {
					return err
				}
			}
			var err error
			link, err = q.CreateClubLink(ctx, gen.CreateClubLinkParams{
				ClubID: clubID, Purpose: purpose, Token: token,
				Label: textOf(req.Label), ExpiresAt: expiresAt, CreatedBy: &userID,
			})
			return err
		})
		if err != nil {
			if msg, ok := asQuotaExceeded(err); ok {
				writeError(w, CodeQuotaExceeded, msg, nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal membuat tautan.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, newClubLinkDTO(link))
	}
}

// handleListClubLinks — GET /clubs/{clubId}/links, RequirePerm(ManageMembers).
func handleListClubLinks(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		var links []gen.ClubLink
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			links, err = q.ListActiveClubLinks(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar tautan.", nil)
			return
		}
		dtos := make([]clubLinkDTO, 0, len(links))
		for _, l := range links {
			dtos = append(dtos, newClubLinkDTO(l))
		}
		writeJSON(w, http.StatusOK, dtos)
	}
}

// handleRotateClubLink — POST /clubs/{clubId}/links/{id}/rotate (§6.4:
// "token bisa diputar ulang, poster lama otomatis mati").
func handleRotateClubLink(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		linkID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Tautan tidak ditemukan.", nil)
			return
		}
		token, err := newLinkToken()
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat token baru.", nil)
			return
		}

		var link gen.ClubLink
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			l, err := q.RotateClubLink(ctx, gen.RotateClubLinkParams{ID: linkID, ClubID: clubID, Token: token})
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			link = l
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal memutar token.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Tautan tidak ditemukan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newClubLinkDTO(link))
	}
}

// handleClubLinkPoster — GET /clubs/{clubId}/links/{id}/poster?format=pdf|png&size=a4|a5
// (§6.4), RequirePerm(ManageMembers). Berkas siap cetak dari internal/poster
// — satu render, PDF dan PNG identik piksel demi piksel (§4.4).
func handleClubLinkPoster(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		linkID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Tautan tidak ditemukan.", nil)
			return
		}

		var link gen.ClubLink
		var club gen.Club
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			l, err := q.GetClubLink(ctx, gen.GetClubLinkParams{ID: linkID, ClubID: clubID})
			if errors.Is(err, pgx.ErrNoRows) {
				notFound = true
				return nil
			}
			if err != nil {
				return err
			}
			link = l
			club, err = q.GetClub(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil tautan.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Tautan tidak ditemukan.", nil)
			return
		}

		size := poster.A4
		if r.URL.Query().Get("size") == "a5" {
			size = poster.A5
		}

		out, err := poster.Render(poster.Input{
			ClubName:    club.Name,
			ShortURL:    publicBaseURL[len("https://"):] + "/" + club.Slug,
			Instruction: "Pindai buat gabung klub",
			JoinURL:     publicBaseURL + "/join/" + link.Token,
			Size:        size,
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat poster.", nil)
			return
		}

		if r.URL.Query().Get("format") == "png" {
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Disposition", `inline; filename="poster-`+club.Slug+`.png"`)
			_, _ = w.Write(out.PNG)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `inline; filename="poster-`+club.Slug+`.pdf"`)
		_, _ = w.Write(out.PDF)
	}
}

// handleRevokeClubLink — DELETE /clubs/{clubId}/links/{id}.
func handleRevokeClubLink(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		linkID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Tautan tidak ditemukan.", nil)
			return
		}
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			return q.RevokeClubLink(ctx, gen.RevokeClubLinkParams{ID: linkID, ClubID: clubID})
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencabut tautan.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
