package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/perm"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Tiga kantong uang (PLAN.md §9.2, API.md §4 "Kas & QRIS") + pengeluaran
// manual bendahara. Deposit dan iuran turnamen sengaja TIDAK digabung ke
// kas klub — lihat komentar treasury.sql.

// transparansiKas baca saklar clubs.settings.transparansi_kas (default
// true — defaultSettingsJSON, clubs.go), pola sama dgn siapaBolehCatat
// (middleware_tenant.go). clubs.settings SELALU diisi lengkap saat klub
// dibuat jadi unmarshal parsial ke bool aman: field hilang → false, BUKAN
// bawaan aplikasi (true) — makanya di sini defaultnya di-flip manual
// kalau kuncinya benar-benar tidak ada di JSON.
func transparansiKas(c gen.Club) bool {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(c.Settings, &raw); err != nil {
		return true
	}
	v, ok := raw["transparansi_kas"]
	if !ok {
		return true
	}
	var b bool
	if err := json.Unmarshal(v, &b); err != nil {
		return true
	}
	return b
}

type treasuryDTO struct {
	KasKlub       int64 `json:"kas_klub"`
	TitipanPemain int64 `json:"titipan_pemain"`
	IuranTurnamen int64 `json:"iuran_turnamen"`
}

// handleGetTreasury — GET /clubs/{clubId}/treasury (§9.2). Saklar
// transparansi_kas: true → anggota mana pun boleh lihat; false → cuma
// bendahara/admin (perm.ManageMoney), dicek manual di sini (BUKAN
// RequirePerm di router) karena aksesnya BERSYARAT pada settings klub,
// bukan tetap seperti endpoint lain.
func handleGetTreasury(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())

		var dto treasuryDTO
		var club gen.Club
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			club, err = q.GetClub(ctx, clubID)
			if err != nil {
				return err
			}
			income, err := q.SumPaidKokIncome(ctx, clubID)
			if err != nil {
				return err
			}
			expenses, err := q.SumExpenses(ctx, clubID)
			if err != nil {
				return err
			}
			wallets, err := q.SumClubWalletTotal(ctx, clubID)
			if err != nil {
				return err
			}
			fees, err := q.SumTournamentFeesPaid(ctx, clubID)
			if err != nil {
				return err
			}
			dto = treasuryDTO{KasKlub: income - expenses, TitipanPemain: wallets, IuranTurnamen: fees}
			return nil
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil ringkasan kas.", nil)
			return
		}

		if !transparansiKas(club) {
			granted, _ := permFromContext(r.Context())
			if !perm.Has(granted, perm.ManageMoney) {
				writeError(w, CodeInsufficientPermission, "Transparansi kas dimatikan di klub ini — cuma bendahara/admin yang bisa lihat.", nil)
				return
			}
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type expenseDTO struct {
	ID        uuid.UUID `json:"id"`
	Amount    int64     `json:"amount"`
	TypeName  *string   `json:"type_name,omitempty"`
	Slops     int32     `json:"slops"`
	Note      *string   `json:"note,omitempty"`
	CreatedAt string    `json:"created_at"`
}

func newExpenseDTO(e gen.Expense) expenseDTO {
	return expenseDTO{
		ID: e.ID, Amount: e.Amount, TypeName: textOrNil(e.TypeName), Slops: e.Slops,
		Note: textOrNil(e.Note), CreatedAt: tsOrZero(e.CreatedAt).Format(rfc3339),
	}
}

type createExpenseRequest struct {
	Amount    int64  `json:"amount"`
	KokTypeID string `json:"kok_type_id"`
	TypeName  string `json:"type_name"`
	Slops     int32  `json:"slops"`
	Note      string `json:"note"`
}

// handleCreateExpense — POST /clubs/{clubId}/expenses (§9.2, perm.
// ManageMoney di router). amount boleh negatif (kas masuk / penyesuaian,
// DDL.sql) — beda dari topup dompet yang menolak arah negatif, kas klub
// bukan dompet perorangan jadi tidak ada larangan minus di sini; bendahara
// yang bertanggung jawab atas angkanya (tercatat recorded_by + jurnal).
func handleCreateExpense(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var req createExpenseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount == 0 {
			writeError(w, CodeValidationFailed, "amount wajib diisi dan tidak nol.", nil)
			return
		}
		var kokTypeID *uuid.UUID
		if req.KokTypeID != "" {
			id, err := uuid.Parse(req.KokTypeID)
			if err != nil {
				writeError(w, CodeValidationFailed, "kok_type_id tidak valid.", nil)
				return
			}
			kokTypeID = &id
		}

		var expense gen.Expense
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			expense, err = q.CreateManualExpense(ctx, gen.CreateManualExpenseParams{
				ClubID: clubID, Amount: req.Amount, KokTypeID: kokTypeID,
				TypeName: textOf(req.TypeName), Slops: req.Slops, Note: textOf(req.Note), RecordedBy: &userID,
			})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mencatat pengeluaran.", nil)
			return
		}
		writeJSON(w, http.StatusCreated, newExpenseDTO(expense))
	}
}

const expensesPageSize = 30

// handleListExpenses — GET /clubs/{clubId}/expenses (perm.ManageMoney,
// pasangan alami POST expenses — bendahara butuh riwayatnya, bukan cuma
// bisa menulis).
func handleListExpenses(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		limit := expensesPageSize
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
				limit = n
			}
		}

		var rows []gen.Expense
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			rows, err = q.ListExpenses(ctx, gen.ListExpensesParams{ClubID: clubID, Limit: int32(limit)})
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil riwayat pengeluaran.", nil)
			return
		}
		items := make([]expenseDTO, 0, len(rows))
		for _, e := range rows {
			items = append(items, newExpenseDTO(e))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}
