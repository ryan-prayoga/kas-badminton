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
			r.Get("/me", handleGetMe(s))

			// Pusat notifikasi in-app, preferensi, langganan push (§10, F8)
			// — lintas klub, bukan /clubs/{clubId}/... (notifications.go).
			r.Get("/me/notifications", handleListMyNotifications(s))
			r.Get("/me/notification-prefs", handleGetNotificationPrefs(s))
			r.Group(func(r chi.Router) {
				r.Use(RequireIdempotency(s))
				r.Post("/me/notifications/{id}/read", handleMarkNotificationRead(s))
				r.Patch("/me/notification-prefs", handlePatchNotificationPrefs(s))
				r.Post("/me/push-subscriptions", handleCreatePushSubscription(s))
				r.Delete("/me/push-subscriptions/{id}", handleDeletePushSubscription(s))
			})

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
					r.Get("/me/bill", handleGetMyBill(s))
					r.Get("/me/wallet", handleGetMyWallet(s))
					// Akses bersyarat pada saklar transparansi_kas, dicek
					// manual di handler — bukan RequirePerm tetap (treasury.go).
					r.Get("/treasury", handleGetTreasury(s))
					// QRIS statis — siapa pun anggota boleh baca (layar
					// bayar); PUT-nya di bawah, digerbang ManageMoney.
					r.Get("/qris", handleGetQris(s))
					// Papan peringkat (§8.3) — akses bersyarat pada saklar
					// papan_peringkat, dicek manual (leaderboard.go), sama
					// pola dgn treasury di atas.
					r.Get("/leaderboard", handleGetLeaderboard(s))

					r.Group(func(r chi.Router) {
						r.Use(RequireIdempotency(s))

						r.Group(func(r chi.Router) {
							r.Use(RequirePerm(perm.ManageMembers))
							r.Patch("/settings", handlePatchClubSettings(s))
							r.Patch("/members/{userId}/role", handleUpdateMemberRole(s))
							r.Post("/members/{userId}/relocate-phone", handleRelocatePhone(s))
							r.Post("/invites", handleCreateInvite(s, notifier))
						})

						// Pemain tamu (§8.1) — dibuat pencatat SAAT mencatat main,
						// bukan cuma admin (pencatat butuh alur ini secepat mungkin,
						// menunggu admin akan mematikan alur catat main).
						r.With(RequirePerm(perm.RecordGame)).Post("/members/guest", handleCreateGuestMember(s))

						// Diri sendiri ATAU admin — bukan RequirePerm murni,
						// dicek manual di handler (clubs_members.go).
						r.Patch("/members/{userId}/auto-deduct", handleUpdateAutoDeduct(s))

						r.Group(func(r chi.Router) {
							r.Use(RequirePerm(perm.ManageMoney))
							r.Get("/bills", handleListClubBills(s))
							r.Post("/bills/mark-paid", handleMarkBillsPaid(s))
							r.Get("/wallet/{userId}", handleGetWallet(s))
							r.Post("/wallet/{userId}/topup", handleTopupWallet(s))
							r.Post("/wallet/{userId}/withdraw", handleWithdrawWallet(s))
							r.Post("/payments/{id}/verify", handleVerifyPayment(s))
							r.Post("/payments/{id}/reject", handleRejectPayment(s))
							r.Get("/expenses", handleListExpenses(s))
							r.Post("/expenses", handleCreateExpense(s))
							r.Put("/qris", handlePutQris(s))
						})

						// Klaim "sudah transfer" — HAK PEMAIN atas tagihannya sendiri
						// (§9.3), bukan RequirePerm: dicek manual lewat payer_id di
						// query (payments.go), sama pola dgn sanggahan (games.go).
						r.Post("/payments/claim", handleClaimPayment(s))
						r.Post("/payments/claim/{id}/cancel", handleCancelPayment(s))

						// QR dinamis — anggota mana pun (bukan ManageMoney):
						// dipakai pemain sendiri saat bayar (§9.6).
						r.Post("/qris/dynamic", handleCreateDynamicQris(s))
						r.Post("/qris/dynamic/{id}/report-rejected", handleReportQrisDynamicRejected(s))

						// Share teks (§5.9, F8) — HAK PEMAIN/bendahara buat
						// bill (dicek manual, share.go), turnamen terbuka.
						r.Post("/share/bill/{userId}", handleShareBill(s))
						r.Post("/share/tournament/{id}", handleShareTournament(s))
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
							r.Post("/{id}/undo", handleUndoGame(s))
						})

						// Sanggahan (§9.4) — HAK PEMAIN, bukan RequirePerm:
						// siapa pun anggota klub boleh menyanggah barisnya
						// sendiri (dicek manual di handler); menyelesaikan
						// dicek manual juga (pencatat ATAU bendahara, dua
						// izin terpisah — lihat komentar handler).
						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Post("/{id}/players/{playerId}/dispute", handleDisputeGamePlayer(s))
							r.Post("/{id}/players/{playerId}/resolve-dispute", handleResolveGamePlayerDispute(s))
						})

						// Taruhan kok "yang kalah bayar kok" (§8.2, §8.4) —
						// preset payer_id, sama gerbang RecordGame dgn catat main.
						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Use(RequirePerm(perm.RecordGame))
							r.Post("/{id}/settle-bet", handleSettleBet(s))
						})
					})

					// Taruhan barang (§8.4) — ledger terpisah tanpa rupiah,
					// anggota mana pun (bukan RequirePerm, side_bets.go).
					// GET+POST+PATCH SATU r.Route (bukan r.Get terpisah di
					// path yang sama) — chi menolak Route() dua kali di
					// pattern yang sama, sama jebakan yang sudah dicatat di
					// claim-requests di atas.
					r.Route("/side-bets", func(r chi.Router) {
						r.Get("/", handleListSideBets(s))
						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Post("/", handleCreateSideBet(s))
							r.Patch("/{id}", handlePatchSideBet(s))
						})
					})

					// F7 (PLAN.md §14, API.md §5) — turnamen. Baca terbuka
					// buat anggota mana pun (sama pola /games); tulis
					// (buat, skor, kok) digerbang RecordGame — pencatat;
					// uang (iuran, kok lunas) digerbang ManageMoney —
					// bendahara, sama pemisahan izin dgn /bills.
					r.Route("/tournaments", func(r chi.Router) {
						r.Get("/", handleListTournaments(s))
						r.Get("/{id}", handleGetTournament(s))
						r.Get("/{id}/fees", handleListTournamentFees(s))

						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Use(RequirePerm(perm.RecordGame))
							r.Post("/", handleCreateTournament(s))
							r.Patch("/{id}", handlePatchTournament(s))
							r.Post("/{id}/matches/{matchId}/score", handleScoreMatch(s))
							r.Post("/{id}/matches/{matchId}/koks", handleAddMatchKok(s))
							r.Post("/{id}/koks", handleAddTournamentKok(s))
						})

						r.Group(func(r chi.Router) {
							r.Use(RequireIdempotency(s))
							r.Use(RequirePerm(perm.ManageMoney))
							r.Post("/{id}/fees/{userId}/mark-paid", handleMarkTournamentFeePaid(s))
							r.Post("/{id}/kok-charges/mark-paid", handleMarkKokChargesPaid(s))
						})
					})
				})
			})
		})
	})
}
