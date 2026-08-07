package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

type pinSetBody struct {
	Pin string `json:"pin"`
}

// handlePinSet — POST /auth/pin/set, di belakang RequireAuth.
func handlePinSet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}

		var req pinSetBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}

		if err := auth.SetPin(r.Context(), s, userID, req.Pin); err != nil {
			writePinError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

type pinVerifyBody struct {
	Phone       string `json:"phone"`
	Pin         string `json:"pin"`
	DeviceLabel string `json:"device_label"`
}

// handlePinVerify — POST /auth/pin/verify, publik: nomor+PIN → sesi baru.
func handlePinVerify(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req pinVerifyBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.DeviceLabel == "" {
			req.DeviceLabel = deviceLabelFromUA(r)
		}

		token, user, err := auth.VerifyPin(r.Context(), s, req.Phone, req.Pin, req.DeviceLabel)
		if err != nil {
			writePinError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, authResultDTO{SessionToken: token, User: newUserDTOFrom(user)})
	}
}

func writePinError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidPin):
		writeError(w, CodeValidationFailed, "PIN harus 6 digit.", nil)
	case errors.Is(err, auth.ErrInvalidPhone):
		writeError(w, CodeValidationFailed, "Nomor WA harus format internasional, mis. +6281234567890.", nil)
	case errors.Is(err, auth.ErrPinLocked):
		writeError(w, CodeRateLimited, "PIN terkunci sementara — kebanyakan percobaan salah. Coba lagi nanti.", nil)
	case errors.Is(err, auth.ErrPinWrong):
		writeError(w, CodeValidationFailed, "PIN salah.", nil)
	case errors.Is(err, auth.ErrPinNotSet):
		writeError(w, CodeValidationFailed, "Belum ada PIN buat akun ini. Masuk pakai OTP dulu.", nil)
	default:
		writeError(w, CodeValidationFailed, "Gagal memproses PIN.", nil)
	}
}
