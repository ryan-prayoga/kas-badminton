package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// creationOptionsDTO/assertionOptionsDTO membungkus keluaran resmi paket
// go-webauthn (protocol.CredentialCreation/CredentialAssertion, sudah
// berbentuk {"publicKey": {...}} siap dioper ke navigator.credentials.*)
// dengan satu field tambahan: session_id. Ceremony WebAuthn dua langkah
// butuh state di antaranya (webauthn.SessionData) — session_id inilah
// kuncinya di ChallengeStore, klien wajib mengembalikannya lewat query
// string ?session_id=... di panggilan verify (API.md §1).
type creationOptionsDTO struct {
	*protocol.CredentialCreation
	SessionID string `json:"session_id"`
}

type assertionOptionsDTO struct {
	*protocol.CredentialAssertion
	SessionID string `json:"session_id"`
}

// handlePasskeyRegisterOptions — POST /auth/passkey/register/options,
// RequireAuth (§7.2: passkey didaftarkan sesudah klaim, bukan usernameless).
func handlePasskeyRegisterOptions(s *store.Store, wa *webauthn.WebAuthn, challenges *auth.ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		creation, sessionID, err := auth.BeginPasskeyRegister(r.Context(), s, wa, challenges, userID)
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal memulai pendaftaran passkey.", nil)
			return
		}
		writeJSON(w, http.StatusOK, creationOptionsDTO{CredentialCreation: creation, SessionID: sessionID})
	}
}

// handlePasskeyRegisterVerify — POST /auth/passkey/register/verify?session_id=...,
// RequireAuth. Body-nya WAJIB respons navigator.credentials.create() mentah
// (protocol.ParseCredentialCreationResponse membaca r.Body langsung).
func handlePasskeyRegisterVerify(s *store.Store, wa *webauthn.WebAuthn, challenges *auth.ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, sessionID, ok := userAndSessionFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		challengeID := r.URL.Query().Get("session_id")
		if challengeID == "" {
			writeError(w, CodeValidationFailed, "session_id wajib disertakan sebagai query string.", nil)
			return
		}

		err := auth.FinishPasskeyRegister(r.Context(), s, wa, challenges, userID, challengeID, r, sessionID, deviceLabelFromUA(r))
		if err != nil {
			writePasskeyError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// handlePasskeyLoginOptions — POST /auth/passkey/login/options, publik.
// Discoverable/usernameless — browser menawarkan passkey tersimpan tanpa
// server tahu nomor lebih dulu (§7.2 "buka berikutnya... cukup Face ID").
func handlePasskeyLoginOptions(wa *webauthn.WebAuthn, challenges *auth.ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		assertion, sessionID, err := auth.BeginPasskeyLogin(wa, challenges)
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal memulai login passkey.", nil)
			return
		}
		writeJSON(w, http.StatusOK, assertionOptionsDTO{CredentialAssertion: assertion, SessionID: sessionID})
	}
}

// handlePasskeyLoginVerify — POST /auth/passkey/login/verify?session_id=...,
// publik. Sukses → sesi baru, setara alur OTP/PIN.
func handlePasskeyLoginVerify(s *store.Store, wa *webauthn.WebAuthn, challenges *auth.ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		challengeID := r.URL.Query().Get("session_id")
		if challengeID == "" {
			writeError(w, CodeValidationFailed, "session_id wajib disertakan sebagai query string.", nil)
			return
		}

		token, user, err := auth.FinishPasskeyLogin(r.Context(), s, wa, challenges, challengeID, r, deviceLabelFromUA(r))
		if err != nil {
			writePasskeyError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, authResultDTO{SessionToken: token, User: newUserDTOFrom(user)})
	}
}

func writePasskeyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrWebauthnChallengeExpired):
		writeError(w, CodeValidationFailed, "Sesi pendaftaran/login passkey kedaluwarsa. Ulangi dari awal.", nil)
	case errors.Is(err, auth.ErrWebauthnNoCredential):
		writeError(w, CodeValidationFailed, "Passkey ini tidak dikenali.", nil)
	default:
		writeError(w, CodeValidationFailed, "Verifikasi passkey gagal. Coba lagi atau pakai PIN.", nil)
	}
}
