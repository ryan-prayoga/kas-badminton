// Test F6/1 (PLAN.md §14 F6, §9.1, §9.5): ledger dompet append-only,
// top-up/tarik bendahara, dan potong otomatis yang dipicu dari POST games
// (§9.5 aturan C). Pola sama f2/f5_main_test.go — Postgres sungguhan.
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func gameBodyWithKok(userID string, pricePerPerson int64) map[string]any {
	body := createGameBody(userID)
	body["koks"] = []map[string]any{
		{"type_name": "kok test", "price_per_person": pricePerPerson, "qty": 1},
	}
	return body
}

func TestWallet_TopupAndWithdraw_BendaharaOnly(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// Member sendiri TIDAK boleh top-up (perm.ManageMoney, bukan dipegang member biasa).
	selfResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", member.token,
		map[string]any{"amount": 10000})
	defer selfResp.Body.Close()
	if selfResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, selfResp, "member top-up dompet sendiri harus ditolak")
	}

	topupResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", admin.token,
		map[string]any{"amount": 20000, "note": "transfer BCA"})
	defer topupResp.Body.Close()
	if topupResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, topupResp, "admin top-up dompet member")
	}
	var topupOut struct {
		Balance int64 `json:"balance"`
	}
	_ = json.NewDecoder(topupResp.Body).Decode(&topupOut)
	if topupOut.Balance != 20000 {
		t.Fatalf("saldo setelah top-up = %d, mau 20000", topupOut.Balance)
	}

	// GET me/wallet — member baca dompetnya sendiri.
	myWalletResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/me/wallet", member.token, nil)
	defer myWalletResp.Body.Close()
	var myWallet struct {
		Balance int64 `json:"balance"`
		Entries []struct {
			Kind   string `json:"kind"`
			Amount int64  `json:"amount"`
		} `json:"entries"`
	}
	_ = json.NewDecoder(myWalletResp.Body).Decode(&myWallet)
	if myWallet.Balance != 20000 || len(myWallet.Entries) != 1 || myWallet.Entries[0].Kind != "topup" {
		t.Fatalf("me/wallet setelah top-up = %+v, mau balance 20000 dgn 1 entry topup", myWallet)
	}

	// Tarik melebihi saldo → ditolak, saldo tidak berubah.
	overWithdrawResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/withdraw", admin.token,
		map[string]any{"amount": 50000})
	defer overWithdrawResp.Body.Close()
	if overWithdrawResp.StatusCode != http.StatusBadRequest && overWithdrawResp.StatusCode != http.StatusUnprocessableEntity {
		dumpAndFail(t, overWithdrawResp, "tarik melebihi saldo harus ditolak")
	}

	withdrawResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/withdraw", admin.token,
		map[string]any{"amount": 5000, "note": "diambil tunai"})
	defer withdrawResp.Body.Close()
	if withdrawResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, withdrawResp, "tarik saldo dalam batas")
	}
	var withdrawOut struct {
		Balance int64 `json:"balance"`
	}
	_ = json.NewDecoder(withdrawResp.Body).Decode(&withdrawOut)
	if withdrawOut.Balance != 15000 {
		t.Fatalf("saldo setelah tarik = %d, mau 15000", withdrawOut.Balance)
	}

	// GET wallet/{userId} — bendahara/admin lihat dompet orang lain.
	adminViewResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID, admin.token, nil)
	defer adminViewResp.Body.Close()
	var adminView struct {
		Balance int64 `json:"balance"`
	}
	_ = json.NewDecoder(adminViewResp.Body).Decode(&adminView)
	if adminView.Balance != 15000 {
		t.Fatalf("wallet/{userId} milik admin = %d, mau 15000", adminView.Balance)
	}

	// Member biasa TIDAK boleh melihat dompet orang lain lewat jalur bendahara.
	memberViewResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID, member.token, nil)
	defer memberViewResp.Body.Close()
	if memberViewResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, memberViewResp, "member baca GET wallet/{userId} (jalur bendahara) harus ditolak")
	}
}

// TestWallet_AutoDeduct_OnGameCreate — inti §9.5 aturan C: begitu game
// disimpan dan payer punya deposit cukup, tagihan langsung tertutup DALAM
// respons yang sama (wallet_deductions), bukan lewat round-trip terpisah.
func TestWallet_AutoDeduct_OnGameCreate(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	topupResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", admin.token,
		map[string]any{"amount": 50000})
	defer topupResp.Body.Close()
	if topupResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, topupResp, "top-up sebelum main")
	}

	gameResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, gameBodyWithKok(member.userID, 15000))
	defer gameResp.Body.Close()
	if gameResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, gameResp, "catat main dgn deposit cukup")
	}
	var game struct {
		ID               string `json:"id"`
		WalletDeductions []struct {
			PayerID  string `json:"payer_id"`
			ItemID   string `json:"item_id"`
			Amount   int64  `json:"amount"`
			PlayedOn string `json:"played_on"`
		} `json:"wallet_deductions"`
		Players []struct {
			ID string `json:"id"`
		} `json:"players"`
	}
	_ = json.NewDecoder(gameResp.Body).Decode(&game)
	if len(game.WalletDeductions) != 1 || game.WalletDeductions[0].Amount != 15000 {
		t.Fatalf("wallet_deductions = %+v, mau 1 baris Rp15000", game.WalletDeductions)
	}
	// item_id yang disebut wallet_deductions harus persis baris tagihan
	// game ini sendiri (§9.5 aturan B "menyebut tagihan mana saja yang
	// tertutup") — bukan players[].paid_at di respons yang sama, karena
	// dto.Players adalah snapshot SEBELUM potong-otomatis jalan (games.go);
	// klien merekonsiliasi status lunas lewat wallet_deductions ini.
	if len(game.Players) != 1 || game.WalletDeductions[0].ItemID != game.Players[0].ID {
		t.Fatalf("wallet_deductions[0].item_id = %q, mau sama dgn players[0].id = %q", game.WalletDeductions[0].ItemID, game.Players[0].ID)
	}

	// Tagihanku sekarang 0 dan saldo dompet berkurang persis sebesar tagihan.
	billResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/me/bill", member.token, nil)
	defer billResp.Body.Close()
	var bill struct {
		TotalOwed     int64 `json:"total_owed"`
		WalletBalance int64 `json:"wallet_balance"`
	}
	_ = json.NewDecoder(billResp.Body).Decode(&bill)
	if bill.TotalOwed != 0 {
		t.Fatalf("total_owed setelah potong otomatis = %d, mau 0", bill.TotalOwed)
	}
	if bill.WalletBalance != 35000 {
		t.Fatalf("wallet_balance setelah potong otomatis = %d, mau 35000", bill.WalletBalance)
	}
}

// TestWallet_AutoDeduct_OffLeavesUnpaid — saklar auto_deduct dimatikan
// (§9.1 "bisa dimatikan per pemain") berarti deposit TIDAK disentuh sama
// sekali walau saldonya cukup.
func TestWallet_AutoDeduct_OffLeavesUnpaid(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	topupResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", admin.token,
		map[string]any{"amount": 50000})
	defer topupResp.Body.Close()
	if topupResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, topupResp, "top-up")
	}

	offResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/members/"+member.userID+"/auto-deduct", member.token,
		map[string]bool{"auto_deduct": false})
	defer offResp.Body.Close()
	if offResp.StatusCode != http.StatusOK {
		dumpAndFail(t, offResp, "matikan auto-deduct")
	}

	gameResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, gameBodyWithKok(member.userID, 15000))
	defer gameResp.Body.Close()
	if gameResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, gameResp, "catat main dgn auto-deduct mati")
	}
	var game struct {
		WalletDeductions []any `json:"wallet_deductions"`
	}
	_ = json.NewDecoder(gameResp.Body).Decode(&game)
	if len(game.WalletDeductions) != 0 {
		t.Fatalf("wallet_deductions dgn auto-deduct mati = %+v, mau kosong", game.WalletDeductions)
	}

	billResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/me/bill", member.token, nil)
	defer billResp.Body.Close()
	var bill struct {
		TotalOwed     int64 `json:"total_owed"`
		WalletBalance int64 `json:"wallet_balance"`
	}
	_ = json.NewDecoder(billResp.Body).Decode(&bill)
	if bill.TotalOwed != 15000 {
		t.Fatalf("total_owed dgn auto-deduct mati = %d, mau tetap 15000", bill.TotalOwed)
	}
	if bill.WalletBalance != 50000 {
		t.Fatalf("wallet_balance dgn auto-deduct mati = %d, mau tetap 50000 (tidak tersentuh)", bill.WalletBalance)
	}
}
