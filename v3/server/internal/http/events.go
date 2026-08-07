package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

const sseHeartbeatInterval = 25 * time.Second

// handleEvents — GET /api/v1/events?club_id=<uuid>&club_id=<uuid>...
// (API.md §8). Satu koneksi per klien, bukan per klub.
//
// Klub yang boleh didengarkan divalidasi SATU PER SATU lewat pengecekan
// keanggotaan yang sama dengan RequireClub (§6.2) — TIDAK ada jalan
// pintas lintas klub di sini. Ini sengaja: memberships ber-RLS, dan RLS
// tanpa SET LOCAL app.club_id yang tepat mengembalikan nol baris (gagal
// menutup, bukan membocorkan — DDL.sql catatan pengeksekusi). Jadi "semua
// klub yang kuikuti" dari SATU query lintas klub sengaja tidak dibuat di
// F2 — klien mengirim club_id yang dia tahu (dari hasil POST /clubs atau
// join sebelumnya); auto-discover lewat GET /me menyusul di F4 (API.md
// §1), events.go tinggal pakai daftar itu tanpa berubah.
func handleEvents(s *store.Store, bus *realtime.Bus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFromContext(r.Context())
		if !ok {
			writeError(w, CodeUnauthenticated, "Sesi kamu sudah berakhir. Masuk lagi buat lanjut.", nil)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, CodeValidationFailed, "Server tidak mendukung realtime di jalur ini.", nil)
			return
		}

		requested := r.URL.Query()["club_id"]
		clubIDs := make([]uuid.UUID, 0, len(requested))
		for _, raw := range requested {
			id, err := uuid.Parse(raw)
			if err != nil {
				continue
			}
			ok, err := isMember(r.Context(), s, id, userID)
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal memeriksa keanggotaan klub.", nil)
				return
			}
			if ok {
				clubIDs = append(clubIDs, id)
			}
			// club_id yang bukan milik user diam-diam diabaikan (bukan
			// error) — sama semangatnya dengan RequireClub 404: tidak
			// mengonfirmasi ke pemanggil apakah klub itu ada.
		}

		ch, unsubscribe := bus.Subscribe(clubIDs)
		defer unsubscribe()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		heartbeat := time.NewTicker(sseHeartbeatInterval)
		defer heartbeat.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-heartbeat.C:
				fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
			case evt, ok := <-ch:
				if !ok {
					return
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Kind, evt.Data)
				flusher.Flush()
			}
		}
	}
}

func isMember(ctx context.Context, s *store.Store, clubID, userID uuid.UUID) (bool, error) {
	found := false
	err := s.WithClub(ctx, clubID, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: userID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		found = true
		return nil
	})
	return found, err
}
