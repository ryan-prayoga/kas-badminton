// Passkey (WebAuthn) — PLAN.md §7.2, paket terkunci go-webauthn/webauthn
// (§4.4). Ceremony-nya dua langkah (options → verify); state di antara
// keduanya (webauthn.SessionData/challenge) TIDAK disimpan di DB — cukup
// cache di memori dengan TTL pendek (pola sama semangatnya dengan realtime
// bus: satu proses, tanpa Redis, target skala ~300 orang §4.2).
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// NewWebAuthn membungkus webauthn.New dengan config aplikasi sendiri
// (internal/config, BUKAN const tersebar — RPID/origin beda tiap
// lingkungan, lihat komentar di config.go).
func NewWebAuthn(cfg config.Config) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          cfg.WebAuthnRPID,
		RPDisplayName: cfg.WebAuthnRPDisplayName,
		RPOrigins:     cfg.WebAuthnRPOrigins,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationPreferred,
		},
	})
}

// --- state ceremony sementara ---

const challengeTTL = 5 * time.Minute

type challengeEntry struct {
	data    webauthn.SessionData
	userID  uuid.UUID // uuid.Nil buat login discoverable — user belum diketahui
	expires time.Time
}

// ChallengeStore — sekali pakai, dibaca-lalu-dibuang (take), pola sama OTP:
// state hidup singkat, cukup di memori (bukan DB/Redis). Aman dipakai
// concurrent (mutex).
type ChallengeStore struct {
	mu   sync.Mutex
	data map[string]challengeEntry
}

func NewChallengeStore() *ChallengeStore {
	return &ChallengeStore{data: make(map[string]challengeEntry)}
}

func (c *ChallengeStore) put(sd webauthn.SessionData, userID uuid.UUID) (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(buf)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweep()
	c.data[id] = challengeEntry{data: sd, userID: userID, expires: time.Now().Add(challengeTTL)}
	return id, nil
}

// take mengambil DAN menghapus — satu challenge cuma boleh dijawab sekali,
// mencegah replay assertion yang sama dua kali.
func (c *ChallengeStore) take(id string) (challengeEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.data[id]
	if !ok {
		return challengeEntry{}, false
	}
	delete(c.data, id)
	if time.Now().After(e.expires) {
		return challengeEntry{}, false
	}
	return e, true
}

// sweep — dipanggil tiap put (bukan goroutine timer terpisah, cukup buat
// skala ~300 orang §4.2) supaya entri kedaluwarsa yang tidak pernah diambil
// (user batal di tengah) tidak menumpuk selamanya.
func (c *ChallengeStore) sweep() {
	now := time.Now()
	for k, v := range c.data {
		if now.After(v.expires) {
			delete(c.data, k)
		}
	}
}

// --- adaptor webauthn.User ---

type webauthnUser struct {
	user  gen.User
	creds []gen.WebauthnCredential
}

func (u webauthnUser) WebAuthnID() []byte          { return u.user.ID[:] }
func (u webauthnUser) WebAuthnName() string        { return u.user.Phone.String }
func (u webauthnUser) WebAuthnDisplayName() string { return u.user.DisplayName }

func (u webauthnUser) WebAuthnCredentials() []webauthn.Credential {
	out := make([]webauthn.Credential, 0, len(u.creds))
	for _, c := range u.creds {
		cred := webauthn.Credential{ID: c.CredentialID, PublicKey: c.PublicKey}
		cred.Authenticator.SignCount = uint32(c.SignCount)
		if len(c.Aaguid) == 16 {
			copy(cred.Authenticator.AAGUID[:], c.Aaguid)
		}
		out = append(out, cred)
	}
	return out
}

func loadWebauthnUser(ctx context.Context, s *store.Store, userID uuid.UUID) (webauthnUser, error) {
	var wu webauthnUser
	err := s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		u, err := q.GetUser(ctx, userID)
		if err != nil {
			return err
		}
		wu.user = u
		wu.creds, err = q.ListWebauthnCredentialsByUser(ctx, userID)
		return err
	})
	return wu, err
}

func findCredentialRow(creds []gen.WebauthnCredential, id []byte) (gen.WebauthnCredential, bool) {
	for _, c := range creds {
		if string(c.CredentialID) == string(id) {
			return c, true
		}
	}
	return gen.WebauthnCredential{}, false
}

// --- registrasi ---

var (
	ErrWebauthnChallengeExpired = errors.New("auth: sesi pendaftaran/login passkey kedaluwarsa, ulangi dari awal")
	ErrWebauthnNoCredential     = errors.New("auth: belum ada passkey terdaftar")
)

// BeginPasskeyRegister — POST /auth/passkey/register/options, RequireAuth.
// userID dari sesi yang sedang aktif (§7.2 — daftar passkey terjadi
// sesudah klaim, bukan usernameless).
func BeginPasskeyRegister(ctx context.Context, s *store.Store, wa *webauthn.WebAuthn, challenges *ChallengeStore, userID uuid.UUID) (*protocol.CredentialCreation, string, error) {
	wu, err := loadWebauthnUser(ctx, s, userID)
	if err != nil {
		return nil, "", fmt.Errorf("auth: muat user buat daftar passkey: %w", err)
	}

	creation, sessionData, err := wa.BeginRegistration(wu,
		webauthn.WithExclusions(webauthn.Credentials(wu.WebAuthnCredentials()).CredentialDescriptors()),
	)
	if err != nil {
		return nil, "", fmt.Errorf("auth: mulai pendaftaran passkey: %w", err)
	}

	cid, err := challenges.put(*sessionData, userID)
	if err != nil {
		return nil, "", err
	}
	return creation, cid, nil
}

// FinishPasskeyRegister — POST /auth/passkey/register/verify?session_id=...,
// RequireAuth. currentSessionID (sesi Bearer token yang dipakai memanggil
// endpoint ini) ditempel ke kredensial baru — dicabut bersama kalau
// perangkat ini dikeluarkan (§7.2.2).
func FinishPasskeyRegister(ctx context.Context, s *store.Store, wa *webauthn.WebAuthn, challenges *ChallengeStore, userID uuid.UUID, challengeID string, r *http.Request, currentSessionID uuid.UUID, deviceLabel string) error {
	entry, ok := challenges.take(challengeID)
	if !ok || entry.userID != userID {
		return ErrWebauthnChallengeExpired
	}

	wu, err := loadWebauthnUser(ctx, s, userID)
	if err != nil {
		return fmt.Errorf("auth: muat user buat selesaikan pendaftaran passkey: %w", err)
	}

	cred, err := wa.FinishRegistration(wu, entry.data, r)
	if err != nil {
		return fmt.Errorf("auth: verifikasi passkey gagal: %w", err)
	}

	aaguid := cred.Authenticator.AAGUID[:]
	sid := currentSessionID
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateWebauthnCredential(ctx, gen.CreateWebauthnCredentialParams{
			UserID:       userID,
			CredentialID: cred.ID,
			PublicKey:    cred.PublicKey,
			SignCount:    int64(cred.Authenticator.SignCount),
			Aaguid:       aaguid,
			DeviceLabel:  textArg(deviceLabel),
			SessionID:    &sid,
		})
		return err
	})
}

// --- login ---

// BeginPasskeyLogin — POST /auth/passkey/login/options, publik. Discoverable
// (usernameless): browser menawarkan pilihan passkey tersimpan, server
// belum tahu siapa sampai FinishPasskeyLogin (§7.2 "buka berikutnya...
// cukup Face ID").
func BeginPasskeyLogin(wa *webauthn.WebAuthn, challenges *ChallengeStore) (*protocol.CredentialAssertion, string, error) {
	assertion, sessionData, err := wa.BeginDiscoverableLogin()
	if err != nil {
		return nil, "", fmt.Errorf("auth: mulai login passkey: %w", err)
	}
	cid, err := challenges.put(*sessionData, uuid.Nil)
	if err != nil {
		return nil, "", err
	}
	return assertion, cid, nil
}

// FinishPasskeyLogin — POST /auth/passkey/login/verify?session_id=...,
// publik. Sukses → sesi baru (setara alur OTP/PIN, §7.2).
func FinishPasskeyLogin(ctx context.Context, s *store.Store, wa *webauthn.WebAuthn, challenges *ChallengeStore, challengeID string, r *http.Request, deviceLabel string) (rawToken string, user gen.User, err error) {
	entry, ok := challenges.take(challengeID)
	if !ok || entry.userID != uuid.Nil {
		return "", gen.User{}, ErrWebauthnChallengeExpired
	}

	var loaded webauthnUser
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		uid, err := uuid.FromBytes(userHandle)
		if err != nil {
			return nil, err
		}
		loaded, err = loadWebauthnUser(ctx, s, uid)
		if err != nil {
			return nil, err
		}
		return loaded, nil
	}

	cred, err := wa.FinishDiscoverableLogin(handler, entry.data, r)
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: verifikasi login passkey gagal: %w", err)
	}

	row, found := findCredentialRow(loaded.creds, cred.ID)
	if !found {
		return "", gen.User{}, ErrWebauthnNoCredential
	}

	err = s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		return q.UpdateWebauthnCredentialSignCount(ctx, gen.UpdateWebauthnCredentialSignCountParams{
			ID: row.ID, SignCount: int64(cred.Authenticator.SignCount),
		})
	})
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: simpan sign_count passkey: %w", err)
	}

	rawToken, _, err = Create(ctx, s, loaded.user.ID, deviceLabel)
	if err != nil {
		return "", gen.User{}, fmt.Errorf("auth: buat sesi: %w", err)
	}
	return rawToken, loaded.user, nil
}
