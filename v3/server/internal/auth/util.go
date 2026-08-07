package auth

import (
	"crypto/subtle"

	"github.com/jackc/pgx/v5/pgtype"
)

// constantTimeEqual — perbandingan hash waktu-konstan, mencegah timing
// attack menebak kode OTP/PIN byte demi byte lewat selisih waktu respons.
func constantTimeEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// textArg pola sama httpapi.textOf — dipakai di sini juga karena
// internal/auth tidak boleh bergantung ke internal/http (arahnya
// sebaliknya).
func textArg(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: s != ""}
}
