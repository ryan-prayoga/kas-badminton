package domain

import (
	"math/rand"
	"testing"
)

func TestWalletBalance_JumlahLedger(t *testing.T) {
	entries := []WalletEntry{
		{Kind: WalletTopup, Amount: 10_000},
		{Kind: WalletPemakaian, Amount: -3000},
		{Kind: WalletTopup, Amount: 2000},
	}
	if got := WalletBalance(entries); got != 9000 {
		t.Fatalf("balance = %d, mau 9000", got)
	}
}

func TestAppendEntry_TolakBikinMinus(t *testing.T) {
	entries := []WalletEntry{{Kind: WalletTopup, Amount: 5000}}
	_, err := AppendEntry(entries, WalletEntry{Kind: WalletPemakaian, Amount: -6000})
	if err == nil {
		t.Fatal("harusnya ditolak — saldo cuma 5000")
	}
	out, err := AppendEntry(entries, WalletEntry{Kind: WalletPemakaian, Amount: -5000})
	if err != nil {
		t.Fatalf("pas-pasan ke nol harusnya boleh: %v", err)
	}
	if WalletBalance(out) != 0 {
		t.Fatalf("balance = %d, mau 0", WalletBalance(out))
	}
}

func TestPlanAutoDeduct_BestFitSamaDenganCicilan(t *testing.T) {
	refs := []WalletDebtRef{
		{Slot: TouchedSlot{Kind: DebtKindGame, ID: "a"}, Amount: 3000, Date: "2026-01-01"},
		{Slot: TouchedSlot{Kind: DebtKindGame, ID: "b"}, Amount: 2500, Date: "2026-01-02"},
		{Slot: TouchedSlot{Kind: DebtKindGame, ID: "c"}, Amount: 10_000, Date: "2026-01-03"},
	}
	// Saldo 10.000: nutup pas ke tagihan c (best-fit), bukan a+b duluan cuma
	// karena lebih lama.
	plan := PlanAutoDeduct(10_000, refs)
	if len(plan.Touched) != 1 || plan.Touched[0].ID != "c" {
		t.Fatalf("touched = %+v", plan.Touched)
	}
	if plan.Deducted != 10_000 || plan.RemainingBalance != 0 {
		t.Fatalf("deducted=%d remaining=%d", plan.Deducted, plan.RemainingBalance)
	}
}

func TestPlanAutoDeduct_SaldoNolTidakMotong(t *testing.T) {
	refs := []WalletDebtRef{{Slot: TouchedSlot{ID: "a"}, Amount: 1000}}
	plan := PlanAutoDeduct(0, refs)
	if len(plan.Touched) != 0 || plan.RemainingBalance != 0 {
		t.Fatalf("plan = %+v", plan)
	}
}

// TestWalletInvariants_PropertyBased — saldo tidak pernah minus, dan jumlah
// ledger selalu sama dengan saldo, di bawah urutan topup/pemakaian/potong-
// otomatis acak (PLAN.md §14 F1: "property-based test untuk dompet").
func TestWalletInvariants_PropertyBased(t *testing.T) {
	rng := rand.New(rand.NewSource(42))

	for trial := 0; trial < 200; trial++ {
		var entries []WalletEntry
		balance := int64(0)

		for step := 0; step < 50; step++ {
			switch rng.Intn(3) {
			case 0: // topup acak
				amt := int64(rng.Intn(20_000))
				e := WalletEntry{Kind: WalletTopup, Amount: amt}
				var err error
				entries, err = AppendEntry(entries, e)
				if err != nil {
					t.Fatalf("topup positif tidak boleh ditolak: %v", err)
				}
				balance += amt

			case 1: // pemakaian acak, kadang sengaja lebih besar dari saldo
				amt := int64(rng.Intn(15_000))
				before := entries
				out, err := AppendEntry(entries, WalletEntry{Kind: WalletPemakaian, Amount: -amt})
				if amt > balance {
					if err == nil {
						t.Fatalf("pemakaian %d > saldo %d harusnya ditolak", amt, balance)
					}
					if len(out) != len(before) {
						t.Fatal("entries harusnya tidak berubah saat ditolak")
					}
				} else {
					if err != nil {
						t.Fatalf("pemakaian %d ≤ saldo %d harusnya boleh: %v", amt, balance, err)
					}
					entries = out
					balance -= amt
				}

			case 2: // potong otomatis lewat planner best-fit
				n := rng.Intn(4)
				refs := make([]WalletDebtRef, n)
				for i := range refs {
					refs[i] = WalletDebtRef{
						Slot:   TouchedSlot{Kind: DebtKindGame, ID: string(rune('a' + i))},
						Amount: int64(rng.Intn(9000)),
						Date:   "2026-01-01",
					}
				}
				plan := PlanAutoDeduct(balance, refs)
				if plan.RemainingBalance < 0 {
					t.Fatalf("RemainingBalance minus: %+v", plan)
				}
				if plan.Deducted+plan.RemainingBalance != balance {
					t.Fatalf("deducted+remaining != balance: %+v (balance=%d)", plan, balance)
				}
				if plan.Deducted > 0 {
					var err error
					entries, err = AppendEntry(entries, WalletEntry{Kind: WalletPemakaian, Amount: -plan.Deducted})
					if err != nil {
						t.Fatalf("hasil planner sendiri harusnya selalu valid: %v", err)
					}
					balance = plan.RemainingBalance
				}
			}

			// Invarian inti: saldo tidak pernah minus, dan selalu sama
			// dengan jumlah ledger.
			if WalletBalance(entries) < 0 {
				t.Fatalf("trial %d step %d: WalletBalance minus = %d", trial, step, WalletBalance(entries))
			}
			if WalletBalance(entries) != balance {
				t.Fatalf("trial %d step %d: WalletBalance=%d != tracked balance=%d", trial, step, WalletBalance(entries), balance)
			}
		}
	}
}
