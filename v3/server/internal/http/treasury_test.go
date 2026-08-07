// Test F6/3 (PLAN.md §14 F6, §9.2): tiga kantong uang (kas klub, titipan
// pemain, iuran turnamen), saklar transparansi_kas, pengeluaran manual.
// Pola sama f2/wallet_test.go — Postgres sungguhan.
package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type treasuryResp struct {
	KasKlub       int64 `json:"kas_klub"`
	TitipanPemain int64 `json:"titipan_pemain"`
	IuranTurnamen int64 `json:"iuran_turnamen"`
}

func getTreasury(t *testing.T, base, token, clubID string) (*http.Response, treasuryResp) {
	t.Helper()
	resp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+clubID+"/treasury", token, nil)
	var out treasuryResp
	if resp.StatusCode == http.StatusOK {
		_ = json.NewDecoder(resp.Body).Decode(&out)
	}
	return resp, out
}

func TestTreasury_ReflectsPaidBillsExpensesAndDeposits(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// Belum ada apa-apa — semua kantong nol.
	_, empty := getTreasury(t, base, admin.token, club)
	if empty.KasKlub != 0 || empty.TitipanPemain != 0 || empty.IuranTurnamen != 0 {
		t.Fatalf("treasury klub baru = %+v, mau semua 0", empty)
	}

	// Main + tandai lunas → kas klub bertambah persis sebesar tagihan.
	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 10000))
	itemID := game.Players[0].ID
	markResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/bills/mark-paid", admin.token,
		map[string]any{"item_ids": []string{itemID}})
	defer markResp.Body.Close()
	if markResp.StatusCode != http.StatusOK {
		dumpAndFail(t, markResp, "mark-paid")
	}

	_, afterPaid := getTreasury(t, base, admin.token, club)
	if afterPaid.KasKlub != 10000 {
		t.Fatalf("kas_klub setelah lunas = %d, mau 10000", afterPaid.KasKlub)
	}

	// Pengeluaran (beli kok baru) mengurangi kas klub.
	expResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/expenses", admin.token,
		map[string]any{"amount": 4000, "type_name": "kok baru", "slops": 1, "note": "beli 1 slop"})
	defer expResp.Body.Close()
	if expResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, expResp, "create expense")
	}

	_, afterExpense := getTreasury(t, base, admin.token, club)
	if afterExpense.KasKlub != 6000 {
		t.Fatalf("kas_klub setelah pengeluaran 4000 = %d, mau 6000", afterExpense.KasKlub)
	}

	// Deposit masuk TITIPAN PEMAIN, bukan kas klub — dua kantong beda.
	topupResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/wallet/"+member.userID+"/topup", admin.token,
		map[string]any{"amount": 20000})
	defer topupResp.Body.Close()
	if topupResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, topupResp, "top-up")
	}

	_, afterTopup := getTreasury(t, base, admin.token, club)
	if afterTopup.KasKlub != 6000 {
		t.Fatalf("kas_klub setelah top-up dompet = %d, mau tetap 6000 (deposit bukan kas)", afterTopup.KasKlub)
	}
	if afterTopup.TitipanPemain != 20000 {
		t.Fatalf("titipan_pemain = %d, mau 20000", afterTopup.TitipanPemain)
	}

	// Member biasa (transparansi_kas bawaan true) tetap boleh lihat.
	memberResp, memberView := getTreasury(t, base, member.token, club)
	defer memberResp.Body.Close()
	if memberResp.StatusCode != http.StatusOK || memberView.KasKlub != 6000 {
		t.Fatalf("member lihat treasury (transparansi default true) = status %d, %+v", memberResp.StatusCode, memberView)
	}
}

func TestTreasury_TransparansiKasOff_GatesToManageMoney(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// PATCH settings butuh If-Match: <version> (invarian §3.4) — klub baru
	// dibuat selalu version=1, doRequest (f2_test.go) tidak set header itu
	// jadi bikin request manual di sini.
	patchReq, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings",
		bytes.NewReader(mustJSON(map[string]any{"transparansi_kas": false})))
	patchReq.Header.Set("Authorization", "Bearer "+admin.token)
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.Header.Set("Idempotency-Key", uuid.NewString())
	patchReq.Header.Set("If-Match", "1")
	patchResp, err := http.DefaultClient.Do(patchReq)
	if err != nil {
		t.Fatalf("patch settings: %v", err)
	}
	defer patchResp.Body.Close()
	if patchResp.StatusCode != http.StatusOK {
		dumpAndFail(t, patchResp, "matikan transparansi_kas")
	}

	memberResp, _ := getTreasury(t, base, member.token, club)
	defer memberResp.Body.Close()
	if memberResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, memberResp, "member lihat treasury saat transparansi_kas mati harus 403")
	}

	adminResp, _ := getTreasury(t, base, admin.token, club)
	defer adminResp.Body.Close()
	if adminResp.StatusCode != http.StatusOK {
		dumpAndFail(t, adminResp, "admin (ManageMoney) tetap boleh lihat walau transparansi_kas mati")
	}
}

func TestExpenses_CreateListAndMemberDenied(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	deniedResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/expenses", member.token,
		map[string]any{"amount": 5000, "note": "coba-coba"})
	defer deniedResp.Body.Close()
	if deniedResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, deniedResp, "member biasa catat pengeluaran harus ditolak")
	}

	createResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/expenses", admin.token,
		map[string]any{"amount": 5000, "note": "beli air minum"})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, createResp, "admin catat pengeluaran")
	}

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/expenses", admin.token, nil)
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		dumpAndFail(t, listResp, "list expenses")
	}
	var list struct {
		Items []struct {
			Amount int64  `json:"amount"`
			Note   string `json:"note"`
		} `json:"items"`
	}
	_ = json.NewDecoder(listResp.Body).Decode(&list)
	if len(list.Items) != 1 || list.Items[0].Amount != 5000 || list.Items[0].Note != "beli air minum" {
		t.Fatalf("list expenses = %+v, mau 1 baris 5000 'beli air minum'", list.Items)
	}
}
