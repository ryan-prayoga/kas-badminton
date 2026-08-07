package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

var validOTPPurpose = map[string]bool{"claim": true, "device": true, "change_phone": true}

type otpRequestBody struct {
	Phone   string `json:"phone"`
	Purpose string `json:"purpose"`
}

// handleOTPRequest — POST /auth/otp/request (API.md §1). Publik: belum ada
// sesi sama sekali di titik ini.
func handleOTPRequest(s *store.Store, notifier notify.Notifier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req otpRequestBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.Purpose == "" {
			req.Purpose = "device"
		}
		if !validOTPPurpose[req.Purpose] {
			writeError(w, CodeValidationFailed, "purpose harus claim, device, atau change_phone.", nil)
			return
		}

		err := auth.RequestOTP(r.Context(), s, notifier, req.Phone, req.Purpose)
		if err != nil {
			writeOTPError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
	}
}

type otpVerifyBody struct {
	Phone       string `json:"phone"`
	Code        string `json:"code"`
	DeviceLabel string `json:"device_label"`
}

type authResultDTO struct {
	SessionToken string  `json:"session_token"`
	User         userDTO `json:"user"`
}

type userDTO struct {
	ID          string `json:"id"`
	Phone       string `json:"phone"`
	DisplayName string `json:"display_name"`
}

// handleOTPVerify — POST /auth/otp/verify. Verifikasi kode → sesi baru
// (API.md §1: "{phone, code} → {session_token, user}").
func handleOTPVerify(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req otpVerifyBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if req.DeviceLabel == "" {
			req.DeviceLabel = deviceLabelFromUA(r)
		}

		token, user, err := auth.VerifyOTP(r.Context(), s, req.Phone, req.Code, req.DeviceLabel)
		if err != nil {
			writeOTPError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, authResultDTO{SessionToken: token, User: newUserDTOFrom(user)})
	}
}

func writeOTPError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidPhone):
		writeError(w, CodeValidationFailed, "Nomor WA harus format internasional, mis. +6281234567890.", nil)
	case errors.Is(err, auth.ErrRateLimited):
		writeError(w, CodeRateLimited, "Kebanyakan percobaan. Coba lagi beberapa menit lagi.", nil)
	case errors.Is(err, auth.ErrOTPNotFound), errors.Is(err, auth.ErrOTPExpired):
		writeError(w, CodeValidationFailed, "Kode OTP sudah kedaluwarsa. Minta kode baru.", nil)
	case errors.Is(err, auth.ErrOTPTooManyTry):
		writeError(w, CodeRateLimited, "Kebanyakan percobaan salah. Minta kode baru.", nil)
	case errors.Is(err, auth.ErrOTPCodeWrong):
		writeError(w, CodeValidationFailed, "Kode OTP salah.", nil)
	default:
		writeError(w, CodeValidationFailed, "Gagal memproses OTP.", nil)
	}
}

func deviceLabelFromUA(r *http.Request) string {
	ua := r.UserAgent()
	if ua == "" {
		return "Perangkat tidak dikenal"
	}
	if len(ua) > 120 {
		return ua[:120]
	}
	return ua
}
