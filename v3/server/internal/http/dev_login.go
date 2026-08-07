package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

var phoneRe = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type devLoginRequest struct {
	Phone       string `json:"phone"`
	DisplayName string `json:"display_name"`
}

type devLoginResponse struct {
	SessionToken string  `json:"session_token"`
	User         userDTO `json:"user"`
}

type userDTO struct {
	ID          string `json:"id"`
	Phone       string `json:"phone"`
	DisplayName string `json:"display_name"`
}

// handleDevLogin — POST /api/v1/dev/login. TODO(F4): buang endpoint ini,
// ganti alur OTP+passkey+PIN asli (PLAN.md §7.2). Cuma nyala ENV=dev
// supaya multi-tenant + realtime + idempotensi F2 bisa diuji ujung ke
// ujung sebelum identitas sungguhan ada. auth.Validate/Create yang
// dipakai di sini ASLI, dipakai lagi utuh di F4.
func handleDevLogin(s *store.Store, isDev bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isDev {
			http.NotFound(w, r)
			return
		}

		var req devLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if !phoneRe.MatchString(req.Phone) {
			writeError(w, CodeValidationFailed, "Nomor WA harus format internasional, mis. +6281234567890.", nil)
			return
		}
		if req.DisplayName == "" {
			req.DisplayName = "Pemain " + req.Phone[len(req.Phone)-4:]
		}

		var user gen.User
		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			found, err := q.GetUserByPhone(ctx, textOf(req.Phone))
			if err == nil {
				user = found
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			created, err := q.CreateUser(ctx, gen.CreateUserParams{
				Phone:       textOf(req.Phone),
				DisplayName: req.DisplayName,
			})
			if err != nil {
				return err
			}
			user = created
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencari/membuat user dev.", nil)
			return
		}

		rawToken, _, err := auth.Create(r.Context(), s, user.ID, "dev/login")
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membuat sesi.", nil)
			return
		}

		writeJSON(w, http.StatusOK, devLoginResponse{
			SessionToken: rawToken,
			User: userDTO{
				ID:          user.ID.String(),
				Phone:       user.Phone.String,
				DisplayName: user.DisplayName,
			},
		})
	}
}
