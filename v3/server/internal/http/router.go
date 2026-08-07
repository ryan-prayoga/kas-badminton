package httpapi

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/auth"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
)

// Mount memasang seluruh permukaan /api/v1 (F2 clubs+games, F4 auth/1+2 —
// lihat PLAN.md §14) ke router chi yang sudah dikonfigurasi middleware
// dasarnya (RequestID, Recoverer, dst — cmd/api/main.go).
func Mount(r chi.Router, s *store.Store, bus *realtime.Bus, notifier notify.Notifier, wa *webauthn.WebAuthn, challenges *auth.ChallengeStore) {
	r.Route("/api/v1", func(r chi.Router) {
		// Publik, tanpa auth — QR tembok/tautan grup (§6.4). clubId belum
		// diketahui, itulah gunanya token (join.go resolveJoinToken).
		r.Route("/join/{token}", func(r chi.Router) {
			r.Get("/", handleJoinInfo(s))
			r.Post("/", handleJoinRequest(s, notifier))
		})

		r.Route("/auth", func(r chi.Router) {
			// Publik — belum ada sesi sama sekali di titik ini (API.md §1).
			r.Post("/otp/request", handleOTPRequest(s, notifier))
			r.Post("/otp/verify", handleOTPVerify(s))
			r.Post("/pin/verify", handlePinVerify(s))
			r.Post("/passkey/login/options", handlePasskeyLoginOptions(wa, challenges))
			r.Post("/passkey/login/verify", handlePasskeyLoginVerify(s, wa, challenges))

			r.Group(func(r chi.Router) {
				r.Use(RequireAuth(s))
				r.Post("/pin/set", handlePinSet(s))
				r.Post("/passkey/register/options", handlePasskeyRegisterOptions(s, wa, challenges))
				r.Post("/passkey/register/verify", handlePasskeyRegisterVerify(s, wa, challenges))
				r.Post("/logout", handleLogout(s))
				r.Get("/sessions", handleListSessions(s))
				r.Delete("/sessions/{id}", handleRevokeSession(s))
				r.Post("/sessions/revoke-others", handleRevokeOtherSessions(s))
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(RequireAuth(s))

			r.Get("/events", handleEvents(s, bus))

			// Tanpa {clubId} — superadmin TIDAK boleh baca isi klub (§6.5).
			r.Route("/admin", func(r chi.Router) {
				r.Use(RequireSuperadmin(s))
				r.Get("/clubs", handleAdminListClubs(s))
				r.Get("/wa/health", handleAdminWaHealth(notifier))
				r.Get("/notifications/queue-depth", handleAdminQueueDepth(s))
				r.Group(func(r chi.Router) {
					r.Use(RequireIdempotency(s))
					r.Post("/clubs/{id}/suspend", handleAdminSuspendClub(s))
					r.Post("/clubs/{id}/quotas", handleAdminUpdateQuotas(s))
				})
			})

			r.Group(func(r chi.Router) {
				r.Use(RequireIdempotency(s))
				r.Post("/clubs", handleCreateClub(s))
			})

			r.Route("/clubs/{clubId}", func(r chi.Router) {
				// SATU r.Route buat seluruh /claim-requests di bawah — POST
				// "/" (ajukan, §7.3: pemanggil BELUM anggota klub ini) makai
				// RequireClubExists, GET+approve/reject makai RequireClub+
				// VerifyClaim. Digabung di satu r.Route (bukan dua registrasi
				// terpisah di path sama) karena chi menolak Route() dua kali
				// di pattern yang sama.
				r.Route("/claim-requests", func(r chi.Router) {
					r.With(RequireClubExists(s), RequireIdempotency(s)).
						Post("/", handleCreateClaimRequest(s))

					r.Group(func(r chi.Router) {
						r.Use(RequireClub(s))
						r.Use(RequirePerm(perm.VerifyClaim))
						r.Get("/", handleListPendingClaims(s))
						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Post("/{id}/approve", handleApproveClaim(s))
							r.Post("/{id}/reject", handleRejectClaim(s))
						})
					})
				})

				r.Group(func(r chi.Router) {
					r.Use(RequireClub(s))

					r.Get("/", handleGetClub(s))
					r.Get("/members", handleListMembers(s))

					r.Group(func(r chi.Router) {
						r.Use(RequireIdempotency(s))

						r.Group(func(r chi.Router) {
							r.Use(RequirePerm(perm.ManageMembers))
							r.Patch("/settings", handlePatchClubSettings(s))
							r.Patch("/members/{userId}/role", handleUpdateMemberRole(s))
							r.Post("/members/{userId}/relocate-phone", handleRelocatePhone(s))
							r.Post("/invites", handleCreateInvite(s, notifier))
						})

						// Diri sendiri ATAU admin — bukan RequirePerm murni,
						// dicek manual di handler (clubs_members.go).
						r.Patch("/members/{userId}/auto-deduct", handleUpdateAutoDeduct(s))
					})

					r.Route("/links", func(r chi.Router) {
						r.Use(RequirePerm(perm.ManageMembers))
						r.Get("/", handleListClubLinks(s))
						r.Get("/{id}/poster", handleClubLinkPoster(s))
						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Post("/", handleCreateClubLink(s))
							r.Post("/{id}/rotate", handleRotateClubLink(s))
							r.Delete("/{id}", handleRevokeClubLink(s))
						})
					})

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
	})
}
