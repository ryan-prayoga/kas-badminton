// Package auth memvalidasi & menerbitkan sesi (PLAN.md §7.2). Bagian ini
// ASLI, bukan stub F2 — F4 memasang alur OTP/passkey/PIN di depannya untuk
// *membuat* sesi; validasinya (Validate, Touch) sudah selesai di sini dan
// dipakai lagi apa adanya.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// ErrInvalidSession dibalas sebagai 401 unauthenticated oleh
// internal/http.RequireAuth — tidak membedakan "tidak ada", "kedaluwarsa",
// atau "dicabut" ke klien (semuanya sama-sama "masuk lagi").
var ErrInvalidSession = errors.New("auth: sesi tidak valid atau kedaluwarsa")

// SessionTTL — 90 hari, diperpanjang otomatis selama masih dipakai
// (PLAN.md §7.2 "buka app sehari-hari — tanpa OTP").
const SessionTTL = 90 * 24 * time.Hour

// NewToken menghasilkan token sesi mentah 32 byte acak (dikirim ke klien
// SEKALI, tidak pernah disimpan) beserta hash sha256-nya (yang disimpan di
// sessions.token_hash).
func NewToken() (raw string, hash []byte, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, sum[:], nil
}

func hashToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

// Create menerbitkan sesi baru untuk user yang identitasnya SUDAH
// diverifikasi oleh pemanggil (OTP asli di F4, dev/login sementara di F2
// — lihat internal/http/dev_login.go). Fungsi ini sendiri tidak
// memverifikasi apa pun.
func Create(ctx context.Context, s *store.Store, userID uuid.UUID, deviceLabel string) (rawToken string, sess gen.Session, err error) {
	raw, hash, err := NewToken()
	if err != nil {
		return "", gen.Session{}, err
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var dbErr error
		sess, dbErr = q.CreateSession(ctx, gen.CreateSessionParams{
			UserID:      userID,
			TokenHash:   hash,
			DeviceLabel: pgtype.Text{String: deviceLabel, Valid: deviceLabel != ""},
			ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(SessionTTL), Valid: true},
		})
		return dbErr
	})
	if err != nil {
		return "", gen.Session{}, err
	}
	return raw, sess, nil
}

// Validate mencari sesi dari token mentah yang dikirim klien (header
// Authorization: Bearer <token>), menolak yang dicabut/kedaluwarsa, dan
// menyegarkan last_seen_at. Dipakai internal/http.RequireAuth di setiap
// request berautentikasi.
func Validate(ctx context.Context, s *store.Store, rawToken string) (gen.Session, error) {
	if rawToken == "" {
		return gen.Session{}, ErrInvalidSession
	}
	hash := hashToken(rawToken)

	var sess gen.Session
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		found, err := q.GetSessionByTokenHash(ctx, hash)
		if err != nil {
			return ErrInvalidSession
		}
		sess = found
		return q.TouchSession(ctx, sess.ID)
	})
	if err != nil {
		return gen.Session{}, ErrInvalidSession
	}
	return sess, nil
}
