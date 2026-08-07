// Package domain — dompet deposit per pemain (PLAN.md §9.1, baru di v3,
// tidak ada di v2). Ledger append-only; saldo = jumlah ledger, bukan kolom
// yang ditulis langsung — kolom saldo di DB (F2) cuma cache dengan tugas
// rekonsiliasi berkala.
package domain

type WalletEntryKind string

const (
	WalletTopup       WalletEntryKind = "topup"
	WalletPemakaian   WalletEntryKind = "pemakaian"
	WalletRefund      WalletEntryKind = "refund"
	WalletPenyesuaian WalletEntryKind = "penyesuaian"
)

// WalletEntry — satu baris ledger. Amount bertanda: positif menambah saldo
// (topup, refund, penyesuaian naik), negatif menguranginya (pemakaian,
// penyesuaian turun). ID/CreatedAt diisi repo layer (F2) — di sini murni
// angka.
type WalletEntry struct {
	UserID    string
	Kind      WalletEntryKind
	Amount    int64
	CreatedAt string
}

// WalletBalance — saldo = jumlah seluruh ledger. Sengaja bukan field yang
// ditulis langsung di mana pun (§9.1): satu-satunya sumber kebenaran saldo
// adalah menjumlah entries ini.
func WalletBalance(entries []WalletEntry) int64 {
	var bal int64
	for _, e := range entries {
		bal += e.Amount
	}
	return bal
}

// AppendEntry menambah satu baris ledger, menolak kalau hasilnya membuat
// saldo minus (§9.1: "tidak boleh minus. Saldo berhenti di nol; sisa tagihan
// tetap jadi tagihan biasa"). Balik entries yang sama (tidak berubah) kalau
// ditolak.
func AppendEntry(entries []WalletEntry, e WalletEntry) ([]WalletEntry, error) {
	if WalletBalance(entries)+e.Amount < 0 {
		return entries, NewError("saldo dompet tidak boleh minus", 400)
	}
	return append(entries, e), nil
}

// WalletDebtRef — satu tagihan yang jadi kandidat dipotong dari deposit.
// Bentuknya sengaja mirip unpaidRef (debt.go): planner best-fit yang sama
// dipakai untuk keduanya (§9.5 B).
type WalletDebtRef struct {
	Slot      TouchedSlot
	Amount    int64
	Date      string
	CreatedAt string
}

func (r WalletDebtRef) orderKey() string { return r.Date + "\x00" + r.CreatedAt }

// WalletDeductPlan — hasil rencana potong otomatis. RemainingBalance tidak
// pernah negatif (dijamin bestFitPlan cuma memilih ref ber-amount ≤ credit
// tersisa di tiap langkah).
type WalletDeductPlan struct {
	Touched          []TouchedSlot
	Deducted         int64
	RemainingBalance int64
}

// PlanAutoDeduct — potong otomatis pakai planner best-fit yang sama dengan
// cicilan (§9.5 B): saldo dipakai buat menutup kombinasi tagihan yang
// menyisakan saldo paling kecil. Berjalan seketika dalam transaksi yang sama
// begitu game/tagihan dibuat (§9.5 C) — repo layer (F2) yang menjamin
// atomisitasnya; di sini cuma menghitung rencananya.
func PlanAutoDeduct(balance int64, refs []WalletDebtRef) WalletDeductPlan {
	if balance <= 0 || len(refs) == 0 {
		return WalletDeductPlan{RemainingBalance: balance}
	}
	touched, remaining := bestFitPlan(refs,
		func(r WalletDebtRef) int64 { return r.Amount },
		WalletDebtRef.orderKey,
		balance,
	)
	slots := make([]TouchedSlot, len(touched))
	var deducted int64
	for i, r := range touched {
		slots[i] = r.Slot
		deducted += r.Amount
	}
	return WalletDeductPlan{Touched: slots, Deducted: deducted, RemainingBalance: remaining}
}
