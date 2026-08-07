package httpapi

import (
	"encoding/json"
	"net/http"
)

// ErrorCode adalah kode yang dipakai berulang di seluruh API (API.md §0).
// message di respons SUDAH bahasa Indonesia siap tampil — klien tidak
// menerjemahkan code sendiri kecuali untuk pencabangan logika.
type ErrorCode string

const (
	CodeValidationFailed       ErrorCode = "validation_failed"
	CodeUnauthenticated        ErrorCode = "unauthenticated"
	CodeInsufficientPermission ErrorCode = "insufficient_permission"
	CodeNotFound               ErrorCode = "not_found"
	CodeVersionConflict        ErrorCode = "version_conflict"
	CodeIdempotencyKeyReused   ErrorCode = "idempotency_key_reused"
	CodeWalletWouldGoNegative  ErrorCode = "wallet_would_go_negative"
	CodeQuotaExceeded          ErrorCode = "quota_exceeded"
	CodeRateLimited            ErrorCode = "rate_limited"
)

var codeStatus = map[ErrorCode]int{
	CodeValidationFailed:       http.StatusBadRequest,
	CodeUnauthenticated:        http.StatusUnauthorized,
	CodeInsufficientPermission: http.StatusForbidden,
	CodeNotFound:               http.StatusNotFound,
	CodeVersionConflict:        http.StatusConflict,
	CodeIdempotencyKeyReused:   http.StatusConflict,
	CodeWalletWouldGoNegative:  http.StatusUnprocessableEntity,
	CodeQuotaExceeded:          http.StatusTooManyRequests,
	CodeRateLimited:            http.StatusTooManyRequests,
}

type apiError struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
	Detail  any       `json:"detail,omitempty"`
}

type errorEnvelope struct {
	Error apiError `json:"error"`
}

// writeError menulis bentuk galat seragam (API.md §0). detail dipakai
// version_conflict buat menyertakan entitas terbaru supaya klien bisa
// menampilkan pilihan yang jelas, bukan menimpa diam-diam (PLAN.md §9.4).
func writeError(w http.ResponseWriter, code ErrorCode, message string, detail any) {
	status, ok := codeStatus[code]
	if !ok {
		status = http.StatusInternalServerError
	}
	writeJSON(w, status, errorEnvelope{Error: apiError{Code: code, Message: message, Detail: detail}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
