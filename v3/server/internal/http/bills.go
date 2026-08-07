package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type billItemDTO struct {
	Kind string `json:"kind"`
	// ID = game_players.id — yang dikirim balik ke POST bills/mark-paid
	// (item_ids). GameID cuma buat tautan ke detail main; satu game bisa
	// punya BEBERAPA baris tagihan (pemain beda, atau payer_id yang sama
	// menanggung beberapa pemain di game yang sama) jadi game_id sendirian
	// tidak cukup buat menunjuk baris yang mana.
	ID       uuid.UUID `json:"id"`
	GameID   uuid.UUID `json:"game_id"`
	Amount   int64     `json:"amount"`
	PlayedOn string    `json:"played_on"`
	Status   string    `json:"status"` // unpaid | pending_review | disputed
	// Cuma terisi kalau status pending_review (F6/2) — klien butuh ini
	// buat "batalkan klaim" (POST payments/claim/{id}/cancel).
	PaymentID *uuid.UUID `json:"payment_id,omitempty"`
	ClaimedAt *string    `json:"claimed_at,omitempty"`
}

type myBillDTO struct {
	TotalOwed     int64         `json:"total_owed"`
	WalletBalance int64         `json:"wallet_balance"`
	AutoDeduct    bool          `json:"auto_deduct"`
	Items         []billItemDTO `json:"items"`
}

// handleGetMyBill — GET /clubs/{clubId}/me/bill (API.md §4), hero Beranda
// (PLAN.md §14 F5). total_owed dari SumUnpaidByPayer (indeks
// game_players_unpaid_idx, §8.2: payer_id bukan user_id) — item disputed
// TIDAK ikut total tapi tetap ditampilkan biar orangnya tahu kenapa
// angkanya beda dari yang dia kira.
func handleGetMyBill(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var total int64
		var walletBalance int64
		var autoDeduct bool
		var rows []gen.ListUnpaidGamePlayersByPayerRow

		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			total, err = q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: userID})
			if err != nil {
				return err
			}
			walletBalance, err = q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: userID})
			if err != nil {
				return err
			}
			rows, err = q.ListUnpaidGamePlayersByPayer(ctx, gen.ListUnpaidGamePlayersByPayerParams{ClubID: clubID, PayerID: userID})
			if err != nil {
				return err
			}
			membership, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: userID})
			if err != nil {
				return err
			}
			autoDeduct = membership.AutoDeduct
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil tagihan.", nil)
			return
		}

		items := make([]billItemDTO, 0, len(rows))
		for _, row := range rows {
			status := "unpaid"
			item := billItemDTO{
				Kind: "game", ID: row.ID, GameID: row.GameID, Amount: row.Amount,
				PlayedOn: dateString(row.PlayedOn),
			}
			switch {
			case row.DisputedAt.Valid:
				status = "disputed"
			case row.PaymentID != nil:
				status = "pending_review"
				item.PaymentID = row.PaymentID
				if row.ClaimedAt.Valid {
					s := row.ClaimedAt.Time.Format(rfc3339)
					item.ClaimedAt = &s
				}
			}
			item.Status = status
			items = append(items, item)
		}

		writeJSON(w, http.StatusOK, myBillDTO{
			TotalOwed:     total,
			WalletBalance: walletBalance,
			AutoDeduct:    autoDeduct,
			Items:         items,
		})
	}
}

type markPaidRequest struct {
	ItemIDs []string `json:"item_ids"`
}

type markPaidResultItem struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type markPaidResponse struct {
	Results []markPaidResultItem `json:"results"`
}

// handleMarkBillsPaid — POST /clubs/{clubId}/bills/mark-paid (API.md §4),
// bendahara mencatat uang cash diterima (perm.ManageMoney, dipasang di
// router). Aksi massal "boleh berhasil sebagian" (API.md §0) — id yang
// gak valid/gak ketemu/sudah lunas cuma ok:false di baris itu, bukan
// menggagalkan semuanya (dan bukan online-only karena ini murni tulis DB,
// tapi verifikasi pembayaran uang sungguhan lain lagi di F6).
func handleMarkBillsPaid(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var req markPaidRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if len(req.ItemIDs) == 0 {
			writeError(w, CodeValidationFailed, "item_ids kosong.", nil)
			return
		}

		// urutan hasil ngikutin urutan permintaan (bukan urutan map) —
		// UI aksi massal mencocokkan baris per index.
		parsed := make([]*uuid.UUID, len(req.ItemIDs))
		ids := make([]uuid.UUID, 0, len(req.ItemIDs))
		for i, raw := range req.ItemIDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				continue
			}
			parsed[i] = &id
			ids = append(ids, id)
		}

		var okIDs map[uuid.UUID]bool
		if len(ids) > 0 {
			err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
				marked, err := q.MarkGamePlayersPaid(ctx, gen.MarkGamePlayersPaidParams{ClubID: clubID, Ids: ids})
				if err != nil {
					return err
				}
				okIDs = make(map[uuid.UUID]bool, len(marked))
				for _, id := range marked {
					okIDs[id] = true
				}
				return nil
			})
			if err != nil {
				writeError(w, CodeValidationFailed, "Gagal menandai lunas.", nil)
				return
			}
		}

		results := make([]markPaidResultItem, len(req.ItemIDs))
		for i, raw := range req.ItemIDs {
			if parsed[i] == nil {
				results[i] = markPaidResultItem{ID: raw, OK: false, Error: "id tidak valid"}
				continue
			}
			if okIDs[*parsed[i]] {
				results[i] = markPaidResultItem{ID: raw, OK: true}
			} else {
				results[i] = markPaidResultItem{ID: raw, OK: false, Error: "sudah lunas, disanggah, atau tidak ditemukan"}
			}
		}

		writeJSON(w, http.StatusOK, markPaidResponse{Results: results})
	}
}
