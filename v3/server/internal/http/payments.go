package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Pembayaran dua langkah (PLAN.md §9.3, API.md §4): pemain "sudah
// transfer" → menunggu bendahara verifikasi → tagihan tertutup + bayar
// lebih masuk deposit. payment_allocations dobel-fungsi sebagai catatan
// "tagihan mana yang ditutup" DAN kunci yang mengecualikan baris itu dari
// potong-otomatis selama menunggu (§9.5 aturan E — lihat wallet.sql).

type paymentDTO struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	Amount     int64     `json:"amount"`
	Status     string    `json:"status"`
	Method     *string   `json:"method,omitempty"`
	ClaimedAt  *string   `json:"claimed_at,omitempty"`
	VerifiedBy *string   `json:"verified_by,omitempty"`
	Note       *string   `json:"note,omitempty"`
}

func newPaymentDTO(p gen.Payment) paymentDTO {
	dto := paymentDTO{
		ID: p.ID, UserID: p.UserID, Amount: p.Amount, Status: string(p.Status),
		Note: textOrNil(p.Note),
	}
	if p.Method.Valid {
		m := string(p.Method.PaymentMethod)
		dto.Method = &m
	}
	if p.ClaimedAt.Valid {
		s := p.ClaimedAt.Time.Format(rfc3339)
		dto.ClaimedAt = &s
	}
	if p.VerifiedBy != nil {
		s := p.VerifiedBy.String()
		dto.VerifiedBy = &s
	}
	return dto
}

const rfc3339 = "2006-01-02T15:04:05Z07:00"

var claimablePaymentMethods = map[string]bool{
	string(gen.PaymentMethodQrisStatis):  true,
	string(gen.PaymentMethodQrisDinamis): true,
	string(gen.PaymentMethodTransfer):    true,
	string(gen.PaymentMethodTunai):       true,
	string(gen.PaymentMethodDeposit):     true,
}

type claimPaymentRequest struct {
	ItemIDs []string `json:"item_ids"`
	Amount  int64    `json:"amount"`
	Method  string   `json:"method"`
	Note    string   `json:"note"`
}

// handleClaimPayment — POST /clubs/{clubId}/payments/claim (API.md §4
// "Sudah transfer"). Ditolak SELURUHNYA (bukan parsial) kalau ada satu
// saja item_ids yang tidak lagi bisa diklaim (sudah lunas/disanggah/
// terkunci payment lain) — pemain diminta memuat ulang tagihannya,
// daripada diam-diam mengklaim sebagian dari yang dia maksud.
func handleClaimPayment(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var req claimPaymentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, CodeValidationFailed, "Body permintaan tidak valid.", nil)
			return
		}
		if len(req.ItemIDs) == 0 || req.Amount <= 0 {
			writeError(w, CodeValidationFailed, "item_ids dan amount (>0) wajib diisi.", nil)
			return
		}
		if req.Method != "" && !claimablePaymentMethods[req.Method] {
			writeError(w, CodeValidationFailed, "method tidak dikenal.", nil)
			return
		}
		ids := make([]uuid.UUID, 0, len(req.ItemIDs))
		for _, raw := range req.ItemIDs {
			id, err := uuid.Parse(raw)
			if err != nil {
				writeError(w, CodeValidationFailed, "item_ids berisi id yang tidak valid.", nil)
				return
			}
			ids = append(ids, id)
		}

		var payment gen.Payment
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			claimable, err := q.GetClaimableGamePlayers(ctx, gen.GetClaimableGamePlayersParams{
				ClubID: clubID, PayerID: userID, Ids: ids,
			})
			if err != nil {
				return err
			}
			if len(claimable) != len(ids) {
				return errValidation("Sebagian tagihan yang dipilih sudah tidak bisa diklaim (sudah lunas, disanggah, atau sedang diproses klaim lain). Muat ulang tagihanmu.")
			}
			var total int64
			for _, c := range claimable {
				total += c.Amount
			}
			if req.Amount < total {
				return errValidation("amount kurang dari total tagihan yang dipilih.")
			}

			method := gen.NullPaymentMethod{}
			if req.Method != "" {
				method = gen.NullPaymentMethod{PaymentMethod: gen.PaymentMethod(req.Method), Valid: true}
			}
			payment, err = q.CreatePayment(ctx, gen.CreatePaymentParams{
				ClubID: clubID, UserID: userID, Amount: req.Amount, Method: method,
				ClaimedBy: &userID, Note: textOf(req.Note),
			})
			if err != nil {
				return err
			}
			for _, c := range claimable {
				if _, err := q.CreatePaymentAllocation(ctx, gen.CreatePaymentAllocationParams{
					PaymentID: payment.ID, GamePlayerID: &c.ID, Amount: c.Amount,
				}); err != nil {
					return err
				}
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindPaymentClaimed, clubID, map[string]any{
				"club_id": clubID, "payment_id": payment.ID, "user_id": userID, "amount": req.Amount,
			}))
		})
		if err != nil {
			writeWalletError(w, err, "Gagal mengajukan klaim pembayaran.")
			return
		}
		writeJSON(w, http.StatusCreated, newPaymentDTO(payment))
	}
}

// handleCancelPayment — POST /clubs/{clubId}/payments/claim/{id}/cancel,
// pemain sendiri SEBELUM diverifikasi (API.md §4). Melepas kunci potong-
// otomatis seketika (§9.5 aturan E) — CancelPayment (payments.sql) cuma
// menyentuh baris berstatus pending milik pemanggil sendiri.
func handleCancelPayment(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		paymentID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan.", nil)
			return
		}

		var payment gen.Payment
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			p, err := q.CancelPayment(ctx, gen.CancelPaymentParams{
				ID: paymentID, ClubID: clubID, UserID: userID, Note: textOf("Dibatalkan sendiri oleh pemain sebelum diverifikasi."),
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			payment = p
			if err := q.DeletePaymentAllocations(ctx, payment.ID); err != nil {
				return err
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindPaymentRejected, clubID, map[string]any{
				"club_id": clubID, "payment_id": payment.ID, "user_id": userID,
			}))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal membatalkan klaim.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan, bukan milikmu, atau sudah diproses bendahara.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newPaymentDTO(payment))
	}
}

// handleVerifyPayment — POST /clubs/{clubId}/payments/{id}/verify (§9.3,
// perm.ManageMoney di router). Menutup semua tagihan teralokasi DALAM
// transaksi yang sama; kelebihan bayar (amount > total teralokasi) masuk
// deposit lewat appendWalletEntry yang sama dgn topup manual (wallet.go).
func handleVerifyPayment(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		verifierID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		paymentID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan.", nil)
			return
		}

		var payment gen.Payment
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			p, err := q.VerifyPayment(ctx, gen.VerifyPaymentParams{ID: paymentID, ClubID: clubID, VerifiedBy: &verifierID})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			payment = p

			allocations, err := q.ListPaymentAllocationsByPayment(ctx, payment.ID)
			if err != nil {
				return err
			}
			ids := make([]uuid.UUID, 0, len(allocations))
			var allocated int64
			for _, a := range allocations {
				if a.GamePlayerID != nil {
					ids = append(ids, *a.GamePlayerID)
					allocated += a.Amount
				}
			}
			if len(ids) > 0 {
				if _, err := q.MarkPaymentGamePlayersPaid(ctx, gen.MarkPaymentGamePlayersPaidParams{
					ClubID: clubID, Ids: ids, PaidBy: &payment.UserID,
				}); err != nil {
					return err
				}
			}

			// Bayar lebih dari tagihan → sisanya masuk deposit (§9.3).
			if excess := payment.Amount - allocated; excess > 0 {
				pid := payment.ID
				if _, err := appendWalletEntry(ctx, q, clubID, payment.UserID, gen.WalletKindTopup, excess, &pid, &verifierID, "Kelebihan bayar klaim"); err != nil {
					return err
				}
				newBalance, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: payment.UserID})
				if err != nil {
					return err
				}
				if err := publishWalletUpdated(ctx, q, clubID, payment.UserID, newBalance); err != nil {
					return err
				}
			}

			total, err := q.SumUnpaidByPayer(ctx, gen.SumUnpaidByPayerParams{ClubID: clubID, PayerID: payment.UserID})
			if err != nil {
				return err
			}
			if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindBillUpdated, clubID, map[string]any{
				"club_id": clubID, "user_id": payment.UserID, "total_owed": total,
			})); err != nil {
				return err
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindPaymentVerified, clubID, map[string]any{
				"club_id": clubID, "payment_id": payment.ID, "user_id": payment.UserID,
			}))
		})
		if err != nil {
			writeWalletError(w, err, "Gagal memverifikasi pembayaran.")
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan atau sudah diproses.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newPaymentDTO(payment))
	}
}

type rejectPaymentRequest struct {
	Note string `json:"note"`
}

// handleRejectPayment — POST /clubs/{clubId}/payments/{id}/reject (§9.3,
// perm.ManageMoney). Melepas kunci potong-otomatis seketika (§9.5 aturan
// E) — tidak ada perubahan lain, tagihannya kembali "unpaid" biasa.
func handleRejectPayment(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		verifierID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		paymentID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan.", nil)
			return
		}
		var req rejectPaymentRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		var payment gen.Payment
		notFound := false
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			p, err := q.RejectPayment(ctx, gen.RejectPaymentParams{
				ID: paymentID, ClubID: clubID, VerifiedBy: &verifierID, Note: textOf(req.Note),
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					notFound = true
					return nil
				}
				return err
			}
			payment = p
			if err := q.DeletePaymentAllocations(ctx, payment.ID); err != nil {
				return err
			}
			return realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindPaymentRejected, clubID, map[string]any{
				"club_id": clubID, "payment_id": payment.ID, "user_id": payment.UserID,
			}))
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal menolak klaim.", nil)
			return
		}
		if notFound {
			writeError(w, CodeNotFound, "Klaim tidak ditemukan atau sudah diproses.", nil)
			return
		}
		writeJSON(w, http.StatusOK, newPaymentDTO(payment))
	}
}

type clubBillItemDTO struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	GameID    uuid.UUID  `json:"game_id"`
	Amount    int64      `json:"amount"`
	PlayedOn  string     `json:"played_on"`
	Status    string     `json:"status"` // unpaid | pending_review | disputed
	PaymentID *uuid.UUID `json:"payment_id,omitempty"`
	ClaimedAt *string    `json:"claimed_at,omitempty"`
}

// handleListClubBills — GET /clubs/{clubId}/bills?status=unpaid (API.md §4
// "Rekap semua anggota", perm.ManageMoney). Tanpa ?status, semua baris
// yang belum lunas dikembalikan (unpaid+pending_review+disputed) —
// bendahara yang menyaring lewat UI; filter server-side cuma penghematan
// payload kalau klien sudah tahu maunya.
func handleListClubBills(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		statusFilter := r.URL.Query().Get("status")

		var rows []gen.ListClubBillItemsRow
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListClubBillItems(ctx, clubID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil rekap tagihan.", nil)
			return
		}

		items := make([]clubBillItemDTO, 0, len(rows))
		for _, row := range rows {
			status := "unpaid"
			var paymentID *uuid.UUID
			var claimedAt *string
			switch {
			case row.DisputedAt.Valid:
				status = "disputed"
			case row.PaymentStatus.Valid && row.PaymentStatus.PaymentStatus == gen.PaymentStatusPending:
				status = "pending_review"
				paymentID = row.PaymentID
				if row.ClaimedAt.Valid {
					s := row.ClaimedAt.Time.Format(rfc3339)
					claimedAt = &s
				}
			}
			if statusFilter != "" && statusFilter != status {
				continue
			}
			items = append(items, clubBillItemDTO{
				ID: row.ID, UserID: row.PayerID, GameID: row.GameID, Amount: row.Amount,
				PlayedOn: dateString(row.PlayedOn), Status: status, PaymentID: paymentID, ClaimedAt: claimedAt,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}
