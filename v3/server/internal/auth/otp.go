package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// PhoneRe — format E.164 (dulu duplikat di internal/http/dev_login.go,
// sekarang satu tempat dipakai bersama request/verify OTP).
var PhoneRe = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// Angka bawaan OTP (PLAN.md §17: "TTL 5 menit, maks 5 percobaan" — eksplisit
// di dokumen. Rate limit kirim ulang tidak punya angka eksplisit di §17,
// diberi nilai wajar di sini, pola yang sama dengan SessionTTL di
// session.go).
const (
	OTPTTL          = 5 * time.Minute
	OTPMaxAttempts  = 5
	OTPResendLimit  = 3
	OTPResendWindow = 10 * time.Minute
)

var (
	ErrInvalidPhone  = errors.New("auth: format nomor tidak valid")
	ErrRateLimited   = errors.New("auth: kebanyakan percobaan kirim OTP")
	ErrOTPNotFound   = errors.New("auth: tidak ada kode OTP aktif buat nomor ini")
	ErrOTPExpired    = errors.New("auth: kode OTP kedaluwarsa")
	ErrOTPTooManyTry = errors.New("auth: kode OTP sudah kehabisan percobaan")
	ErrOTPCodeWrong  = errors.New("auth: kode OTP salah")
)

// hashOTP pola sama hashToken (sha256 telanjang cukup di sini — kode 6
// digit sengaja berumur pendek & sekali pakai, bukan rahasia jangka
// panjang seperti token sesi).
func hashOTP(code string) []byte {
	sum := sha256.Sum256([]byte(code))
	return sum[:]
}

// generateOTP menghasilkan 6 digit acak — TIDAK memakai math/rand (bisa
// ditebak), crypto/rand seperti NewToken.
func generateOTP() (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1_000_000
	return fmt.Sprintf("%06d", n), nil
}

// RequestOTP mengirim kode 6 digit lewat notifier (WA di produksi,
// notify.Fake di dev/test — internal/notify) dan menyimpan hash-nya.
// purpose ikut §13 DDL: "claim" | "device" | "change_phone".
func RequestOTP(ctx context.Context, s *store.Store, notifier notify.Notifier, phone, purpose string) error {
	if !PhoneRe.MatchString(phone) {
		return ErrInvalidPhone
	}

	var count int64
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		c, err := q.CountRecentOTP(ctx, gen.CountRecentOTPParams{
			Phone:     phone,
			CreatedAt: pgtype.Timestamptz{Time: time.Now().Add(-OTPResendWindow), Valid: true},
		})
		count = c
		return err
	})
	if err != nil {
		return fmt.Errorf("auth: hitung OTP terbaru: %w", err)
	}
	if count >= OTPResendLimit {
		return ErrRateLimited
	}

	code, err := generateOTP()
	if err != nil {
		return fmt.Errorf("auth: buat kode OTP: %w", err)
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateOTP(ctx, gen.CreateOTPParams{
			Phone:     phone,
			CodeHash:  hashOTP(code),
			Purpose:   purpose,
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(OTPTTL), Valid: true},
		})
		return err
	})
	if err != nil {
		return fmt.Errorf("auth: simpan OTP: %w", err)
	}

	return notifier.Send(ctx, notify.Message{
		Phone: phone,
		Body:  fmt.Sprintf("Kode verifikasi Kok Badminton kamu: %s. Berlaku 5 menit, jangan dibagikan ke siapa pun.", code),
	})
}

// VerifyOTP mencocokkan kode, mencari/membuat user by phone (langsung
// 'active' — OTP sudah membuktikan kepemilikan nomor), dan menerbitkan
// sesi baru (auth.Create, PLAN.md §7.2).
func VerifyOTP(ctx context.Context, s *store.Store, phone, code, deviceLabel string) (rawToken string, user gen.User, err error) {
	if !PhoneRe.MatchString(phone) {
		return "", gen.User{}, ErrInvalidPhone
	}

	var otp gen.OtpCode
	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		found, err := q.GetLatestActiveOTP(ctx, phone)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrOTPNotFound
			}
			return err
		}
		otp = found
		return nil
	})
	if err != nil {
		return "", gen.User{}, err
	}

	if otp.Attempts >= OTPMaxAttempts {
		return "", gen.User{}, ErrOTPTooManyTry
	}
	if time.Now().After(otp.ExpiresAt.Time) {
		return "", gen.User{}, ErrOTPExpired
	}

	match := constantTimeEqual(hashOTP(code), otp.CodeHash)
	if !match {
		_ = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
			return q.IncrementOTPAttempts(ctx, otp.ID)
		})
		return "", gen.User{}, ErrOTPCodeWrong
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		if err := q.ConsumeOTP(ctx, otp.ID); err != nil {
			return err
		}

		found, err := q.GetUserByPhone(ctx, textArg(phone))
		if err == nil {
			user = found
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		created, err := q.CreateUser(ctx, gen.CreateUserParams{
			Phone:       textArg(phone),
			DisplayName: "Pemain " + phone[len(phone)-4:],
		})
		if err != nil {
			return err
		}
		user = created
		return nil
	})
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: cari/buat user: %w", err)
	}

	rawToken, _, err = Create(ctx, s, user.ID, deviceLabel)
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: buat sesi: %w", err)
	}
	return rawToken, user, nil
}
