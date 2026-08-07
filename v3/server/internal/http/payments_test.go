// Test F6/2 (PLAN.md §14 F6, §9.3, §9.5 aturan D/E): payments klaim →
// verifikasi/tolak/batal, kunci potong-otomatis selama menunggu, bayar
// lebih masuk deposit. Pola sama f2/wallet_test.go — Postgres sungguhan.
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func claimPayment(t *testing.T, base, token, clubID string, itemIDs []string, amount int64, method string) (string, int) {
	t.Helper()
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+clubID+"/payments/claim", token,
		map[string]any{"item_ids": itemIDs, "amount": amount, "method": method})
	defer resp.Body.Close()
	status := resp.StatusCode
	var out struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.ID, status
}

func TestPayments_ClaimVerify_ClosesBillAndKeepsExcessAsDeposit(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 15000))
	itemID := game.Players[0].ID

	// Klaim kurang dari tagihan → ditolak.
	_, underStatus := claimPayment(t, base, member.token, club, []string{itemID}, 10000, "transfer")
	if underStatus != http.StatusBadRequest {
		t.Fatalf("klaim kurang dari tagihan = %d, mau 400", underStatus)
	}

	// Klaim lebih (bayar lebih 5000) → 5000 masuk deposit saat diverifikasi.
	paymentID, status := claimPayment(t, base, member.token, club, []string{itemID}, 20000, "transfer")
	if status != http.StatusCreated {
		t.Fatalf("klaim status = %d, mau 201", status)
	}

	// Tagihanku sekarang pending_review, TIDAK ikut total_owed.
	bill := getMyBill(t, base, member.token, club)
	if bill.TotalOwed != 0 {
		t.Fatalf("total_owed saat pending_review = %d, mau 0", bill.TotalOwed)
	}
	if len(bill.Items) != 1 || bill.Items[0].Status != "pending_review" || bill.Items[0].PaymentID == nil {
		t.Fatalf("item bill = %+v, mau status pending_review dgn payment_id", bill.Items)
	}

	// Member LAIN (bukan bendahara/admin) tidak boleh verifikasi.
	other := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, other.userID, gen.ClubRoleMember)
	deniedResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/"+paymentID+"/verify", other.token, nil)
	defer deniedResp.Body.Close()
	if deniedResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, deniedResp, "member biasa verifikasi payment harus ditolak")
	}

	verifyResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/"+paymentID+"/verify", admin.token, nil)
	defer verifyResp.Body.Close()
	if verifyResp.StatusCode != http.StatusOK {
		dumpAndFail(t, verifyResp, "verify payment")
	}

	// Verifikasi kedua kali → sudah bukan pending, ditolak.
	verifyAgainResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/"+paymentID+"/verify", admin.token, nil)
	defer verifyAgainResp.Body.Close()
	if verifyAgainResp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, verifyAgainResp, "verify payment dua kali harus 404")
	}

	billAfter := getMyBill(t, base, member.token, club)
	if billAfter.TotalOwed != 0 || len(billAfter.Items) != 0 {
		t.Fatalf("bill setelah verifikasi = %+v, mau lunas total", billAfter)
	}
	if billAfter.WalletBalance != 5000 {
		t.Fatalf("wallet_balance setelah bayar lebih = %d, mau 5000 (kelebihan masuk deposit)", billAfter.WalletBalance)
	}
}

func TestPayments_Reject_ReturnsToUnpaid(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 15000))
	itemID := game.Players[0].ID
	paymentID, status := claimPayment(t, base, member.token, club, []string{itemID}, 15000, "transfer")
	if status != http.StatusCreated {
		t.Fatalf("klaim status = %d, mau 201", status)
	}

	rejectResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/"+paymentID+"/reject", admin.token,
		map[string]string{"note": "bukti transfer tidak jelas"})
	defer rejectResp.Body.Close()
	if rejectResp.StatusCode != http.StatusOK {
		dumpAndFail(t, rejectResp, "reject payment")
	}

	bill := getMyBill(t, base, member.token, club)
	if bill.TotalOwed != 15000 || len(bill.Items) != 1 || bill.Items[0].Status != "unpaid" {
		t.Fatalf("bill setelah ditolak = %+v, mau unpaid 15000 lagi", bill)
	}

	// Klaim ulang sekarang boleh (kunci sudah lepas).
	_, reclaimStatus := claimPayment(t, base, member.token, club, []string{itemID}, 15000, "transfer")
	if reclaimStatus != http.StatusCreated {
		t.Fatalf("klaim ulang setelah ditolak = %d, mau 201", reclaimStatus)
	}
}

func TestPayments_Cancel_SelfOnlyBeforeVerified(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)
	other := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, other.userID, gen.ClubRoleMember)

	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 12000))
	itemID := game.Players[0].ID
	paymentID, status := claimPayment(t, base, member.token, club, []string{itemID}, 12000, "tunai")
	if status != http.StatusCreated {
		t.Fatalf("klaim status = %d, mau 201", status)
	}

	otherCancelResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/claim/"+paymentID+"/cancel", other.token, nil)
	defer otherCancelResp.Body.Close()
	if otherCancelResp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, otherCancelResp, "orang lain batalkan klaim harus ditolak (404, bukan miliknya)")
	}

	selfCancelResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/payments/claim/"+paymentID+"/cancel", member.token, nil)
	defer selfCancelResp.Body.Close()
	if selfCancelResp.StatusCode != http.StatusOK {
		dumpAndFail(t, selfCancelResp, "batalkan klaim sendiri")
	}

	bill := getMyBill(t, base, member.token, club)
	if bill.TotalOwed != 12000 || bill.Items[0].Status != "unpaid" {
		t.Fatalf("bill setelah batal klaim = %+v, mau unpaid lagi", bill)
	}
}

// TestPayments_PendingClaimLocksAutoDeduct — inti §9.5 aturan E: tagihan
// yang sudah diklaim TIDAK disentuh potong-otomatis walau deposit cukup,
// supaya tidak terbayar dua kali begitu klaimnya juga disetujui.
func TestPayments_PendingClaimLocksAutoDeduct(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 12000))
	itemID := game.Players[0].ID
	_, claimStatus := claimPayment(t, base, member.token, club, []string{itemID}, 12000, "tunai")
	if claimStatus != http.StatusCreated {
		t.Fatalf("klaim status = %d, mau 201", claimStatus)
	}

	// Deposit ditambah SETELAH klaim — cukup buat menutup tagihan yang
	// sedang dikunci itu, tapi seharusnya tidak disentuh.
	topupResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", admin.token,
		map[string]any{"amount": 50000})
	defer topupResp.Body.Close()
	if topupResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, topupResp, "top-up")
	}

	// Main lain memicu potong-otomatis (games.go) — kandidatnya cuma
	// tagihan yang TIDAK terkunci payment pending (ListWalletDeductCandidates).
	game2Resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, gameBodyWithKok(member.userID, 8000))
	defer game2Resp.Body.Close()
	if game2Resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, game2Resp, "catat main kedua")
	}
	var game2 struct {
		WalletDeductions []struct {
			ItemID string `json:"item_id"`
			Amount int64  `json:"amount"`
		} `json:"wallet_deductions"`
	}
	_ = json.NewDecoder(game2Resp.Body).Decode(&game2)
	if len(game2.WalletDeductions) != 1 || game2.WalletDeductions[0].ItemID == itemID {
		t.Fatalf("wallet_deductions = %+v, mau 1 baris (game kedua) dan BUKAN menyentuh %s yang sedang diklaim", game2.WalletDeductions, itemID)
	}

	bill := getMyBill(t, base, member.token, club)
	// item pertama masih pending_review (bukan lunas lewat deposit),
	// hanya item kedua yang sudah lunas — total_owed 0 (pending_review
	// dikecualikan juga) tapi saldo cuma berkurang sebesar game kedua.
	if bill.WalletBalance != 42000 { // 50000 - 8000
		t.Fatalf("wallet_balance = %d, mau 42000 (cuma game kedua yg dipotong)", bill.WalletBalance)
	}
}

// gameFullResp, createGameWithBody (f5_main_test.go) dan myBillResp,
// getMyBill (f8_test.go) dipakai ulang — sudah diperluas (Players,
// payment_id) buat kebutuhan F6/2 di sini.
