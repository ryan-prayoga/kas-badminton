package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Dompet deposit (PLAN.md §9.1, API.md §4 "Deposit"). Ledger dibaca sejak
// F5 (SumWalletBalance, selalu 0 sampai sekarang) — di sini baru ada jalur
// yang MENULISNYA: top-up manual, tarik dengan persetujuan, dan potong
// otomatis yang dipicu dari handleCreateGame (games.go).

const walletEntriesPageSize = 50

type walletEntryDTO struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Amount    int64     `json:"amount"`
	Note      *string   `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func newWalletEntryDTO(e gen.WalletEntry) walletEntryDTO {
	return walletEntryDTO{
		ID:        e.ID,
		Kind:      string(e.Kind),
		Amount:    e.Amount,
		Note:      textOrNil(e.Note),
		CreatedAt: tsOrZero(e.CreatedAt),
	}
}

type walletDTO struct {
	Balance int64            `json:"balance"`
	Entries []walletEntryDTO `json:"entries"`
}

func loadWallet(ctx context.Context, q *gen.Queries, clubID, userID uuid.UUID) (walletDTO, error) {
	balance, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: userID})
	if err != nil {
		return walletDTO{}, err
	}
	rows, err := q.ListWalletEntries(ctx, gen.ListWalletEntriesParams{
		ClubID: clubID, UserID: userID, Limit: walletEntriesPageSize,
	})
	if err != nil {
		return walletDTO{}, err
	}
	entries := make([]walletEntryDTO, 0, len(rows))
	for _, e := range rows {
		entries = append(entries, newWalletEntryDTO(e))
	}
	return walletDTO{Balance: balance, Entries: entries}, nil
}

// handleGetMyWallet — GET /clubs/{clubId}/me/wallet (API.md §4 "Deposit").
func handleGetMyWallet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())

		var dto walletDTO
		err := s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			dto, err = loadWallet(ctx, q, clubID, userID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil dompet.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

// handleGetWallet — GET /clubs/{clubId}/wallet/{userId}, bendahara/admin
// melihat dompet anggota lain (perm.ManageMoney, dipasang di router).
func handleGetWallet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clubID, _ := clubIDFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}

		var dto walletDTO
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			dto, err = loadWallet(ctx, q, clubID, targetID)
			return err
		})
		if err != nil {
			writeError(w, CodeValidationFailed, "Gagal mengambil dompet.", nil)
			return
		}
		writeJSON(w, http.StatusOK, dto)
	}
}

type walletAdjustRequest struct {
	Amount int64  `json:"amount"`
	Note   string `json:"note"`
}

// appendWalletEntry menulis satu baris ledger, menolak di lapisan aplikasi
// kalau hasilnya minus (§9.1) — trigger DB (wallet_no_negative, DDL.sql)
// adalah lapisan kedua yang menegakkan hal sama walau jalur ini terlewat.
func appendWalletEntry(ctx context.Context, q *gen.Queries, clubID, userID uuid.UUID, kind gen.WalletKind, amount int64, paymentID, createdBy *uuid.UUID, note string) (gen.WalletEntry, error) {
	balance, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: userID})
	if err != nil {
		return gen.WalletEntry{}, err
	}
	if _, err := domain.AppendEntry([]domain.WalletEntry{{Amount: balance}}, domain.WalletEntry{Amount: amount}); err != nil {
		return gen.WalletEntry{}, errValidation("Saldo dompet tidak boleh minus.")
	}
	return q.CreateWalletEntry(ctx, gen.CreateWalletEntryParams{
		ClubID: clubID, UserID: userID, Kind: kind, Amount: amount,
		PaymentID: paymentID, Note: textOf(note), CreatedBy: createdBy,
	})
}

// handleTopupWallet — POST /clubs/{clubId}/wallet/{userId}/topup, bendahara
// mencatat titipan yang diterima (§9.1). amount > 0 wajib — arahnya
// dikunci di sini supaya klien tidak bisa top-up negatif lewat endpoint ini.
func handleTopupWallet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		var req walletAdjustRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
			writeError(w, CodeValidationFailed, "amount wajib diisi dan lebih dari 0.", nil)
			return
		}

		var entry gen.WalletEntry
		var newBalance int64
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			entry, err = appendWalletEntry(ctx, q, clubID, targetID, gen.WalletKindTopup, req.Amount, nil, &callerID, req.Note)
			if err != nil {
				return err
			}
			newBalance, err = q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: targetID})
			if err != nil {
				return err
			}
			return publishWalletUpdated(ctx, q, clubID, targetID, newBalance)
		})
		if err != nil {
			writeWalletError(w, err, "Gagal mencatat top-up.")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entry": newWalletEntryDTO(entry), "balance": newBalance})
	}
}

// handleWithdrawWallet — POST /clubs/{clubId}/wallet/{userId}/withdraw.
// "Perlu persetujuan admin" (§9.1) ditegakkan lewat SIAPA yang boleh
// memanggil endpoint ini (perm.ManageMoney, router) — bukan alur
// pengajuan+approve terpisah: hanya bendahara/admin yang bisa mengeksekusi
// tarikan, jadi memanggilnya SUDAH berarti disetujui. kind=penyesuaian
// (wallet_kind tidak punya nilai "withdraw" sendiri, DDL.sql) dengan
// amount negatif; trigger DB menolak kalau saldo tidak cukup.
func handleWithdrawWallet(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, _ := userIDFromContext(r.Context())
		clubID, _ := clubIDFromContext(r.Context())
		targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
		if err != nil {
			writeError(w, CodeNotFound, "Anggota tidak ditemukan.", nil)
			return
		}
		var req walletAdjustRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
			writeError(w, CodeValidationFailed, "amount wajib diisi dan lebih dari 0.", nil)
			return
		}

		var entry gen.WalletEntry
		var newBalance int64
		err = s.WithClub(r.Context(), clubID, func(ctx context.Context, q *gen.Queries) error {
			var err error
			entry, err = appendWalletEntry(ctx, q, clubID, targetID, gen.WalletKindPenyesuaian, -req.Amount, nil, &callerID, note("Tarik saldo", req.Note))
			if err != nil {
				return err
			}
			newBalance, err = q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: targetID})
			if err != nil {
				return err
			}
			return publishWalletUpdated(ctx, q, clubID, targetID, newBalance)
		})
		if err != nil {
			writeWalletError(w, err, "Gagal menarik saldo.")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entry": newWalletEntryDTO(entry), "balance": newBalance})
	}
}

func note(prefix, extra string) string {
	if extra == "" {
		return prefix
	}
	return prefix + " — " + extra
}

// writeWalletError membedakan pesan validasi domain (saldo minus, dst —
// dibungkus validationErr, games.go) dari galat teknis lain, sama pola
// dengan handleCreateGame.
func writeWalletError(w http.ResponseWriter, err error, fallback string) {
	var ve *validationErr
	if errors.As(err, &ve) {
		writeError(w, CodeValidationFailed, ve.msg, nil)
		return
	}
	writeError(w, CodeValidationFailed, fallback, nil)
}

// publishWalletUpdated — realtime SEKALIGUS notify.Enqueue "deposit
// berubah" (§10.1). Dipusatkan di sini (bukan di tiap pemanggil — topup,
// tarik, kelebihan bayar klaim, potong otomatis) supaya SETIAP jalur
// yang mengubah saldo otomatis memberi tahu pemiliknya, tanpa ada yang
// lupa ditambah satu-satu.
func publishWalletUpdated(ctx context.Context, q *gen.Queries, clubID, userID uuid.UUID, balance int64) error {
	if err := realtime.Publish(ctx, q, realtime.NewEvent(realtime.KindWalletUpdated, clubID, map[string]any{
		"club_id": clubID, "user_id": userID, "balance": balance,
	})); err != nil {
		return err
	}
	club, err := q.GetClub(ctx, clubID)
	if err != nil {
		return err
	}
	return notify.Enqueue(ctx, q, notify.NotifyInput{
		UserID: userID, ClubID: &clubID, ClubTimezone: club.Timezone,
		Kind: domain.NotifWalletUpdated, Now: time.Now().UTC(),
		Title: "Depositmu berubah",
		Body:  fmt.Sprintf("Saldo depositmu di %s sekarang %s.", club.Name, rupiahText(balance)),
	})
}

// walletDeductionDTO — satu baris tagihan yang ditutup potong otomatis,
// dikembalikan di respons POST games (API.md §4 "Potong otomatis") supaya
// klien bisa menampilkan "Deposit menutup: ..." SEKETIKA (§9.5 aturan B),
// tanpa round-trip tambahan.
type walletDeductionDTO struct {
	PayerID  uuid.UUID `json:"payer_id"`
	ItemID   uuid.UUID `json:"item_id"`
	Amount   int64     `json:"amount"`
	PlayedOn string    `json:"played_on"`
}

// autoDeductForPayer — potong otomatis (§9.5 aturan B & C), dipanggil dari
// DALAM transaksi handleCreateGame seketika setelah tagihan baru dibuat,
// bukan dipicu terpisah (API.md §4). Best-effort dan diam-diam tidak
// melakukan apa pun (bukan error) kalau payer bukan anggota klub ini
// (pemain tamu ditanggung orang lain, §8.1), auto-deduct dimatikan, atau
// saldo nol — potong otomatis TIDAK PERNAH menggagalkan pencatatan main.
func autoDeductForPayer(ctx context.Context, q *gen.Queries, clubID, payerID uuid.UUID) ([]walletDeductionDTO, int64, error) {
	membership, err := q.GetMembership(ctx, gen.GetMembershipParams{ClubID: clubID, UserID: payerID})
	if err != nil {
		return nil, 0, nil // pemain tamu / bukan anggota — lewati diam-diam
	}
	if !membership.AutoDeduct {
		return nil, 0, nil
	}
	balance, err := q.SumWalletBalance(ctx, gen.SumWalletBalanceParams{ClubID: clubID, UserID: payerID})
	if err != nil {
		return nil, 0, err
	}
	if balance <= 0 {
		return nil, balance, nil
	}
	candidates, err := q.ListWalletDeductCandidates(ctx, gen.ListWalletDeductCandidatesParams{ClubID: clubID, PayerID: payerID})
	if err != nil {
		return nil, 0, err
	}
	if len(candidates) == 0 {
		return nil, balance, nil
	}

	refs := make([]domain.WalletDebtRef, 0, len(candidates))
	byID := map[string]gen.ListWalletDeductCandidatesRow{}
	for _, c := range candidates {
		id := c.ID.String()
		byID[id] = c
		refs = append(refs, domain.WalletDebtRef{
			Slot:      domain.TouchedSlot{Kind: domain.DebtKindGame, ID: id},
			Amount:    c.Amount,
			Date:      dateString(c.PlayedOn),
			CreatedAt: tsOrZero(c.CreatedAt).Format(time.RFC3339Nano),
		})
	}
	plan := domain.PlanAutoDeduct(balance, refs)
	if len(plan.Touched) == 0 {
		return nil, balance, nil
	}

	ids := make([]uuid.UUID, len(plan.Touched))
	for i, t := range plan.Touched {
		ids[i] = byID[t.ID].ID
	}
	marked, err := q.MarkGamePlayersDeducted(ctx, gen.MarkGamePlayersDeductedParams{ClubID: clubID, Ids: ids, PaidBy: &payerID})
	if err != nil {
		return nil, 0, err
	}
	markedSet := make(map[uuid.UUID]bool, len(marked))
	for _, id := range marked {
		markedSet[id] = true
	}

	// Satu baris ledger per tagihan yang tersentuh (bukan satu baris
	// gabungan) — jurnal (GET .../wallet/{userId}) jadi langsung terbaca
	// per tagihan tanpa parsing note gabungan.
	deductions := make([]walletDeductionDTO, 0, len(plan.Touched))
	for _, t := range plan.Touched {
		c := byID[t.ID]
		if !markedSet[c.ID] {
			continue // tersentuh jalur lain di antara baca & tandai — dilewati, bukan menggagalkan seluruh main
		}
		if _, err := q.CreateWalletEntry(ctx, gen.CreateWalletEntryParams{
			ClubID: clubID, UserID: payerID, Kind: gen.WalletKindPemakaian, Amount: -c.Amount,
			Note: textOf("Potong otomatis: main " + dateString(c.PlayedOn)),
		}); err != nil {
			return nil, 0, err
		}
		deductions = append(deductions, walletDeductionDTO{
			PayerID: payerID, ItemID: c.ID, Amount: c.Amount, PlayedOn: dateString(c.PlayedOn),
		})
	}
	return deductions, plan.RemainingBalance, nil
}
