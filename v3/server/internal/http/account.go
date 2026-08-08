// Hapus akun & ekspor data pribadi (PLAN.md §12, §12.2, F9/4). Nomor
// telepon itu data pribadi — orang berhak mengunduhnya dan berhak
// menghapus identitasnya, TAPI transaksi keuangan klub tidak boleh ikut
// hilang (klub butuh pembukuannya tetap utuh buat anggota lain).
package httpapi

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type exportGamePlayerDTO struct {
	GameID   string `json:"game_id"`
	PlayedOn string `json:"played_on"`
	Amount   int64  `json:"amount"`
	Paid     bool   `json:"paid"`
	Disputed bool   `json:"disputed"`
}

type exportPaymentDTO struct {
	Amount    int64  `json:"amount"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

type exportWalletEntryDTO struct {
	Kind      string  `json:"kind"`
	Amount    int64   `json:"amount"`
	Note      *string `json:"note,omitempty"`
	CreatedAt string  `json:"created_at"`
}

type exportClubDTO struct {
	ClubSlug string                 `json:"club_slug"`
	ClubName string                 `json:"club_name"`
	Role     string                 `json:"role"`
	Games    []exportGamePlayerDTO  `json:"games"`
	Payments []exportPaymentDTO     `json:"payments"`
	Wallet   []exportWalletEntryDTO `json:"wallet_entries"`
}

type exportDTO struct {
	UserID      string          `json:"user_id"`
	DisplayName string          `json:"display_name"`
	Username    *string         `json:"username,omitempty"`
	Phone       *string         `json:"phone,omitempty"`
	CreatedAt   string          `json:"created_at"`
	Clubs       []exportClubDTO `json:"clubs"`
}

// handleExportMe — GET /me/export (§12 "Ekspor mengembalikan data pribadi
// orang itu"). Lintas klub: loop WithUser (daftar keanggotaan) lalu
// WithClub SEKALI per klub (RLS club_id-scoped) — sama pola dengan
// handleGetMe (me.go) diperluas ke isi tiap klub, bukan cuma daftarnya.
// TIDAK menyertakan data orang lain sama sekali — semua query di sini
// difilter user_id/payer_id = pemanggil sendiri, bukan "semua data klub".
func handleExportMe(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())

		var user gen.User
		var memberships []gen.ListMembershipsWithClubByUserRow
		err := s.WithUser(r.Context(), userID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			user, err = q.GetUser(ctx, userID)
			if err != nil {
				return err
			}
			memberships, err = q.ListMembershipsWithClubByUser(ctx, userID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil data akun.", nil)
			return
		}

		dto := exportDTO{
			UserID: user.ID.String(), DisplayName: user.DisplayName,
			Username: textOrNil(user.Username), Phone: textOrNil(user.Phone),
			CreatedAt: tsOrZero(user.CreatedAt).Format(rfc3339),
			Clubs:     make([]exportClubDTO, 0, len(memberships)),
		}

		for _, m := range memberships {
			clubDTO := exportClubDTO{
				ClubSlug: m.ClubSlug, ClubName: m.ClubName, Role: string(m.Role),
				Games: []exportGamePlayerDTO{}, Payments: []exportPaymentDTO{}, Wallet: []exportWalletEntryDTO{},
			}
			err := s.WithClub(r.Context(), m.ClubID, func(ctx context.Context, q *gen.Queries) error {
				gamePlayers, err := q.ListGamePlayersByUserForExport(ctx, gen.ListGamePlayersByUserForExportParams{ClubID: m.ClubID, PayerID: userID})
				if err != nil {
					return err
				}
				for _, gp := range gamePlayers {
					clubDTO.Games = append(clubDTO.Games, exportGamePlayerDTO{
						GameID: gp.GameID.String(), PlayedOn: dateString(gp.PlayedOn), Amount: gp.Amount,
						Paid: gp.PaidAt.Valid, Disputed: gp.DisputedAt.Valid,
					})
				}

				payments, err := q.ListPaymentsByUserForExport(ctx, gen.ListPaymentsByUserForExportParams{ClubID: m.ClubID, UserID: userID})
				if err != nil {
					return err
				}
				for _, p := range payments {
					clubDTO.Payments = append(clubDTO.Payments, exportPaymentDTO{
						Amount: p.Amount, Status: string(p.Status), CreatedAt: tsOrZero(p.CreatedAt).Format(rfc3339),
					})
				}

				entries, err := q.ListWalletEntries(ctx, gen.ListWalletEntriesParams{ClubID: m.ClubID, UserID: userID, Limit: 100000, Before: pgtype.Timestamptz{}})
				if err != nil {
					return err
				}
				for _, e := range entries {
					clubDTO.Wallet = append(clubDTO.Wallet, exportWalletEntryDTO{
						Kind: string(e.Kind), Amount: e.Amount, Note: textOrNil(e.Note),
						CreatedAt: tsOrZero(e.CreatedAt).Format(rfc3339),
					})
				}
				return nil
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal mengambil sebagian data klub.", nil)
				return
			}
			dto.Clubs = append(dto.Clubs, clubDTO)
		}

		w.Header().Set("Content-Disposition", `attachment; filename="data-saya.json"`)
		writeJSON(w, http.StatusOK, dto)
	}
}

// handleDeleteMe — POST /me/delete (§12 "Hapus akun & ekspor data
// pribadi"). Identitas dianonimkan (AnonymizeUser, migrasi 00024) —
// TIDAK menyentuh game_players/payments/wallet_entries sama sekali, itu
// pembukuan klub yang harus tetap utuh (§12.2). Keanggotaan (memberships)
// SENGAJA dibiarkan apa adanya, bukan diakhiri — orang itu tetap tercatat
// pernah jadi anggota, cuma namanya sekarang "Pemain terhapus"; mengakhiri
// membership di sini cuma menambah kompleksitas tanpa manfaat privasi
// tambahan (nomor teleponnya sudah lepas, itu intinya).
//
// Semua sesi/passkey/PIN/langganan push dicabut — akun ini tidak bisa
// dipakai login lagi setelah ini, sengaja tanpa jalan balik dari sisi
// pengguna (irreversible by design, sama semangat §12.2 "jangan ada
// penghapusan yang tidak bisa dibatalkan" tapi itu soal DATA KLUB, bukan
// soal akses login — akses login akun sendiri boleh final).
func handleDeleteMe(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())

		err := s.WithinTx(r.Context(), func(ctx context.Context, q *gen.Queries) error {
			if _, err := q.AnonymizeUser(ctx, userID); err != nil {
				return err
			}
			if err := q.RevokeAllSessionsByUser(ctx, userID); err != nil {
				return err
			}
			if err := q.DeleteAllWebauthnCredentialsByUser(ctx, userID); err != nil {
				return err
			}
			if err := q.DeletePin(ctx, userID); err != nil {
				return err
			}
			return q.DeleteAllPushSubscriptionsByUser(ctx, userID)
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menghapus akun.", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
	}
}
