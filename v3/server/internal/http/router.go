package httpapi

import (
	"github.com/go-chi/chi/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// Mount memasang seluruh permukaan /api/v1 F2 (slice sempit clubs+games,
// lihat plan F2 §"Sengaja belum dikerjakan" buat yang belum ada) ke
// router chi yang sudah dikonfigurasi middleware dasarnya (RequestID,
// Recoverer, dst — cmd/api/main.go).
func Mount(r chi.Router, s *store.Store, bus *realtime.Bus, isDev bool) {
	r.Route("/api/v1", func(r chi.Router) {
		// Publik, tanpa auth — TODO(F4): ganti/cabut, lihat dev_login.go.
		r.Post("/dev/login", handleDevLogin(s, isDev))

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
						r.Post("/", handleCreateGame(s))
						r.Patch("/{id}", handleUpdateGame(s))
						r.Delete("/{id}", handleDeleteGame(s))
					})
				})
			})
		})
	})
}
