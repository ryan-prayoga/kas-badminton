package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// handleLogout — POST /auth/logout: cabut sesi INI (yang dipakai request
// ini sendiri), bukan semua sesi.
func handleLogout(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, sessionID, ok := userAndSessionFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		if err := auth.RevokeSession(r.Context(), s, userID, sessionID); err != nil {
			writeError(w, CodeValidationFailed, "Gagal keluar.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// userAndSessionFromContext — dua-duanya ditaruh RequireAuth sekali,
// dipakai handler yang perlu tahu sesi request ini sendiri (logout,
// revoke-others, tempel kredensial passkey baru).
func userAndSessionFromContext(ctx context.Context) (userID, sessionID uuid.UUID, ok bool) {
	userID, ok = userIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, uuid.UUID{}, false
	}
	sessionID, ok = sessionIDFromContext(ctx)
	return userID, sessionID, ok
}

// handleListSessions — GET /auth/sessions (§7.2.2): perangkat yang sedang
// masuk, dengan tombol keluarkan per baris di klien.
func handleListSessions(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		sessions, err := auth.ListSessions(r.Context(), s, userID)
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil daftar perangkat.", nil)
			return
		}
		dtos := make([]sessionDTO, 0, len(sessions))
		for _, sess := range sessions {
			dtos = append(dtos, newSessionDTO(sess))
		}
		writeJSON(w, http.StatusOK, dtos)
	}
}

// handleRevokeSession — DELETE /auth/sessions/{id}: keluarkan SATU
// perangkat (§7.2.2).
func handleRevokeSession(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		sessionID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Sesi tidak ditemukan.", nil)
			return
		}
		if err := auth.RevokeSession(r.Context(), s, userID, sessionID); err != nil {
			if errors.Is(err, auth.ErrNotYourSession) {
				writeError(w, CodeNotFound, "Sesi tidak ditemukan.", nil)
				return
			}
			writeError(w, CodeValidationFailed, "Gagal keluarkan perangkat.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// handleRevokeOtherSessions — POST /auth/sessions/revoke-others: "keluarkan
// semua kecuali ini" (§7.2.2).
func handleRevokeOtherSessions(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, sessionID, ok := userAndSessionFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}
		if err := auth.RevokeOtherSessions(r.Context(), s, userID, sessionID); err != nil {
			writeError(w, CodeValidationFailed, "Gagal keluarkan perangkat lain.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
