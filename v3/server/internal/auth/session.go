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
	"github.com/jackc/pgx/v5"
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

// ListSessions — GET /auth/sessions (§7.2.2), terbaru dulu.
func ListSessions(ctx context.Context, s *store.Store, userID uuid.UUID) ([]gen.Session, error) {
	var sessions []gen.Session
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		sessions, err = q.ListSessionsByUser(ctx, userID)
		return err
	})
	return sessions, err
}

// ErrNotYourSession — dibalas 404 (bukan 403) supaya pemanggil tidak bisa
// membedakan "sesi orang lain" dari "sesi tidak ada" (sama semangatnya
// dengan RequireClub yang membalas 404 buat bukan-anggota).
var ErrNotYourSession = errors.New("auth: sesi itu bukan milik kamu")

// RevokeSession — DELETE /auth/sessions/{id} (§7.2.2). ownerID WAJIB
// dicocokkan di sini, bukan cuma di query, supaya jelas endpointnya tidak
// bisa dipakai mencabut sesi orang lain.
func RevokeSession(ctx context.Context, s *store.Store, ownerID, sessionID uuid.UUID) error {
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		sess, err := q.GetSessionByID(ctx, sessionID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotYourSession
			}
			return err
		}
		if sess.UserID != ownerID {
			return ErrNotYourSession
		}
		return q.RevokeSession(ctx, sessionID)
	})
}

// RevokeOtherSessions — POST /auth/sessions/revoke-others (§7.2.2):
// "keluarkan semua kecuali ini".
func RevokeOtherSessions(ctx context.Context, s *store.Store, userID, keepSessionID uuid.UUID) error {
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		return q.RevokeOtherSessions(ctx, gen.RevokeOtherSessionsParams{UserID: userID, ID: keepSessionID})
	})
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
