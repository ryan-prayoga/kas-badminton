package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

var pinRe = regexp.MustCompile(`^[0-9]{6}$`)

// Angka bawaan PIN. PinMaxFailed/PinLockMinutes tidak ada di §17 secara
// eksplisit (cuma "PIN 6 digit sebagai cadangan" di §7.2) — nilai wajar,
// pola sama OTPResendLimit di otp.go.
const (
	PinMaxFailed   = 5
	PinLockMinutes = 15

	// Parameter argon2id (golang.org/x/crypto/argon2, terkunci PLAN.md §4.4)
	// — mengikuti rekomendasi bawaan paket buat interactive login (bukan
	// KDF berkas): time=1, 64MB, 4 thread paralel.
	argonTime    = 1
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

var (
	ErrInvalidPin = errors.New("auth: PIN harus 6 digit")
	ErrPinLocked  = errors.New("auth: PIN terkunci sementara, kebanyakan percobaan salah")
	ErrPinWrong   = errors.New("auth: PIN salah")
	ErrPinNotSet  = errors.New("auth: belum ada PIN buat akun ini")
)

// hashPin — format tersimpan "salt$hash" (base64 raw), self-describing,
// pola yang sama dengan hashPin/verifyPinHash di v2/lib/auth.ts (§4.4)
// cuma algoritmanya diganti argon2id sesuai keputusan terkunci.
func hashPin(pin string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(pin), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(hash), nil
}

func verifyPinHash(pin, stored string) bool {
	parts := strings.SplitN(stored, "$", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pin), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return constantTimeEqual(got, want)
}

// SetPin — POST /auth/pin/set, di belakang RequireAuth (§7.2).
func SetPin(ctx context.Context, s *store.Store, userID uuid.UUID, pin string) error {
	if !pinRe.MatchString(pin) {
		return ErrInvalidPin
	}
	hash, err := hashPin(pin)
	if err != nil {
		return fmt.Errorf("auth: hash PIN: %w", err)
	}
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		return q.UpsertPin(ctx, gen.UpsertPinParams{UserID: userID, PinHash: hash})
	})
}

// VerifyPin — POST /auth/pin/verify, publik: nomor+PIN → sesi baru, setara
// alur passkey login (§7.2 "buka harian... passkey ATAU PIN").
func VerifyPin(ctx context.Context, s *store.Store, phone, pin, deviceLabel string) (rawToken string, user gen.User, err error) {
	if !PhoneRe.MatchString(phone) {
		return "", gen.User{}, ErrInvalidPhone
	}
	if !pinRe.MatchString(pin) {
		return "", gen.User{}, ErrInvalidPin
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		found, err := q.GetUserByPhone(ctx, textArg(phone))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Sengaja balas galat yang SAMA dengan "PIN salah" di bawah —
				// tidak membocorkan apakah nomor itu terdaftar.
				return ErrPinWrong
			}
			return err
		}
		user = found
		return nil
	})
	if err != nil {
		return "", gen.User{}, err
	}

	var pinRow gen.UserPin
	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		found, err := q.GetPin(ctx, user.ID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPinNotSet
			}
			return err
		}
		pinRow = found
		return nil
	})
	if err != nil {
		return "", gen.User{}, err
	}

	if pinRow.LockedUntil.Valid && time.Now().Before(pinRow.LockedUntil.Time) {
		return "", gen.User{}, ErrPinLocked
	}

	if !verifyPinHash(pin, pinRow.PinHash) {
		_ = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
			return q.IncrementPinFailed(ctx, gen.IncrementPinFailedParams{
				MaxFailed: PinMaxFailed, LockMinutes: PinLockMinutes, UserID: user.ID,
			})
		})
		return "", gen.User{}, ErrPinWrong
	}

	_ = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		return q.ResetPinFailed(ctx, user.ID)
	})

	rawToken, _, err = Create(ctx, s, user.ID, deviceLabel)
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: buat sesi: %w", err)
	}
	return rawToken, user, nil
}
