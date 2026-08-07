package httpapi

import (
	"github.com/go-chi/chi/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// Mount memasang seluruh permukaan /api/v1 (F2 clubs+games, F4 auth/1 —
// lihat PLAN.md §14) ke router chi yang sudah dikonfigurasi middleware
// dasarnya (RequestID, Recoverer, dst — cmd/api/main.go).
func Mount(r chi.Router, s *store.Store, bus *realtime.Bus, notifier notify.Notifier) {
	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			// Publik — belum ada sesi sama sekali di titik ini (API.md §1).
			r.Post("/otp/request", handleOTPRequest(s, notifier))
			r.Post("/otp/verify", handleOTPVerify(s))
			r.Post("/pin/verify", handlePinVerify(s))

			r.Group(func(r chi.Router) {
				r.Use(RequireAuth(s))
				r.Post("/pin/set", handlePinSet(s))
				r.Post("/logout", handleLogout(s))
				r.Get("/sessions", handleListSessions(s))
				r.Delete("/sessions/{id}", handleRevokeSession(s))
				r.Post("/sessions/revoke-others", handleRevokeOtherSessions(s))
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(RequireAuth(s))

			r.Get("/events", handleEvents(s, bus))

			r.Group(func(r chi.Router) {
				r.Use(RequireIdempotency(s))
				r.Post("/clubs", handleCreateClub(s))
			})

			r.Route("/clubs/{clubId}", func(r chi.Router) {
				r.Use(RequireClub(s))

				r.Get("/", handleGetClub(s))

				r.Route("/games", func(r chi.Router) {
					r.Get("/", handleListGames(s))
					r.Get("/{id}", handleGetGame(s))

					r.Group(func(r chi.Router) {
						r.Use(RequireIdempotency(s))
						r.Use(RequirePerm(perm.RecordGame))
						r.Post("/", handleCreateGame(s))
						r.Patch("/{id}", handleUpdateGame(s))
						r.Delete("/{id}", handleDeleteGame(s))
					})
				})
			})
		})
	})
}
