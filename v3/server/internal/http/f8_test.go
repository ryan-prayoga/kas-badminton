// Test F5 bagian 1 (PLAN.md §14 F5 "selesai kalau", API.md §1/§4): GET /me
// lintas klub (migrasi 00021, memberships_tenant_read), GET .../me/bill
// (§8.2 "tagihanku dihitung dari payer_id"), POST .../bills/mark-paid.
// Pola sama f2/f4_test.go — Postgres sungguhan, skip kalau
// TEST_DATABASE_URL tidak diset.
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

type meResp struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Memberships []struct {
		ClubID   string `json:"club_id"`
		ClubName string `json:"club_name"`
		Role     string `json:"role"`
	} `json:"memberships"`
}

// TestGetMe_ListsMembershipsAcrossClubs_NoCrossUserLeak — GET /me (§API.md
// 1) harus melihat SEMUA klub milik pemanggil tanpa clubId disebut duluan
// (migrasi 00021 melonggarkan RLS memberships buat baca milik sendiri),
// tapi tidak pernah baris milik user lain.
func TestGetMe_ListsMembershipsAcrossClubs_NoCrossUserLeak(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	userX := otpLogin(t, base, notifier, randPhone())
	clubA := createClub(t, base, userX.token, randSlug())
	clubB := createClub(t, base, userX.token, randSlug())

	userY := otpLogin(t, base, notifier, randPhone())
	addMembership(t, clubA, userY.userID, "member")

	respX := authedRequest(t, http.MethodGet, base+"/api/v1/me", userX.token, nil)
	defer respX.Body.Close()
	if respX.StatusCode != http.StatusOK {
		dumpAndFail(t, respX, "GET /me userX")
	}
	var meX meResp
	if err := json.NewDecoder(respX.Body).Decode(&meX); err != nil {
		t.Fatalf("decode GET /me userX: %v", err)
	}
	if len(meX.Memberships) != 2 {
		t.Fatalf("userX (bikin klub A dan B, admin keduanya) harus lihat 2 membership, dapat %d: %+v", len(meX.Memberships), meX.Memberships)
	}
	seen := map[string]bool{}
	for _, m := range meX.Memberships {
		seen[m.ClubID] = true
		if m.Role != "admin" {
			t.Fatalf("userX pembuat klub %s harus admin, dapat %q", m.ClubID, m.Role)
		}
	}
	if !seen[clubA] || !seen[clubB] {
		t.Fatalf("userX harus lihat klub A(%s) dan B(%s), dapat %+v", clubA, clubB, meX.Memberships)
	}

	respY := authedRequest(t, http.MethodGet, base+"/api/v1/me", userY.token, nil)
	defer respY.Body.Close()
	if respY.StatusCode != http.StatusOK {
		dumpAndFail(t, respY, "GET /me userY")
	}
	var meY meResp
	if err := json.NewDecoder(respY.Body).Decode(&meY); err != nil {
		t.Fatalf("decode GET /me userY: %v", err)
	}
	if len(meY.Memberships) != 1 || meY.Memberships[0].ClubID != clubA {
		t.Fatalf("userY (member klub A doang) harus cuma lihat klub A, dapat %+v — kalau ini bocor ke klub B berarti RLS 00021 salah", meY.Memberships)
	}
}

type myBillResp struct {
	TotalOwed     int64 `json:"total_owed"`
	WalletBalance int64 `json:"wallet_balance"`
	Items         []struct {
		ID        string  `json:"id"`
		GameID    string  `json:"game_id"`
		Amount    int64   `json:"amount"`
		Status    string  `json:"status"`
		PlayedOn  string  `json:"played_on"`
		PaymentID *string `json:"payment_id"`
	} `json:"items"`
}

func getMyBill(t *testing.T, base, token, clubID string) myBillResp {
	t.Helper()
	resp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+clubID+"/me/bill", token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET me/bill")
	}
	var out myBillResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode me/bill: %v", err)
	}
	return out
}

// TestMyBill_AttributesToPayer_MarkPaidClearsIt — §8.2 "siapa main ≠ siapa
// nanggung": A main, payer_id diarahkan ke B — tagihan harus muncul di
// bill B (bukan A), lalu bendahara (ManageMoney) menandai lunas mengosongkan
// total_owed B tanpa menyentuh punya orang lain.
func TestMyBill_AttributesToPayer_MarkPaidClearsIt(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	clubID := createClub(t, base, admin.token, randSlug())

	playerA := otpLogin(t, base, notifier, randPhone())
	payerB := otpLogin(t, base, notifier, randPhone())
	addMembership(t, clubID, playerA.userID, "member")
	addMembership(t, clubID, payerB.userID, "member")

	body := map[string]any{
		"played_on": time.Now().Format("2006-01-02"),
		"format":    "single",
		"players": []map[string]any{
			{"user_id": playerA.userID, "side": "a", "slot": 1, "payer_id": payerB.userID},
		},
		"koks": []map[string]any{
			{"type_name": "Kok test F5", "price_per_person": 6000, "qty": 1},
		},
	}
	gameResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+clubID+"/games", admin.token, body)
	defer gameResp.Body.Close()
	if gameResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, gameResp, "create game (payer beda dari pemain)")
	}

	billA := getMyBill(t, base, playerA.token, clubID)
	if billA.TotalOwed != 0 {
		t.Fatalf("A ikut main tapi B yang nanggung — bill A harus 0, dapat %d", billA.TotalOwed)
	}

	billB := getMyBill(t, base, payerB.token, clubID)
	if billB.TotalOwed <= 0 {
		t.Fatalf("bill B (penanggung) harus > 0, dapat %d", billB.TotalOwed)
	}
	if len(billB.Items) != 1 || billB.Items[0].Status != "unpaid" || billB.Items[0].Amount != billB.TotalOwed {
		t.Fatalf("bill B harus punya 1 item unpaid senilai total_owed, dapat %+v (total=%d)", billB.Items, billB.TotalOwed)
	}
	itemID := billB.Items[0].ID // game_players.id, bukan game_id (lihat billItemDTO.ID)

	// member biasa (bukan bendahara/admin) DITOLAK menandai lunas —
	// perm.ManageMoney (§7.4 "pencatat ditolak saat menyentuh endpoint
	// uang", pola sama berlaku ke member biasa).
	rejected := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+clubID+"/bills/mark-paid", payerB.token,
		map[string]any{"item_ids": []string{itemID}})
	defer rejected.Body.Close()
	if rejected.StatusCode != http.StatusForbidden {
		dumpAndFail(t, rejected, "member biasa coba mark-paid HARUS 403")
	}

	// admin (punya ManageMoney lewat aturan jatuh-balik) berhasil.
	markResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+clubID+"/bills/mark-paid", admin.token,
		map[string]any{"item_ids": []string{itemID}})
	defer markResp.Body.Close()
	if markResp.StatusCode != http.StatusOK {
		dumpAndFail(t, markResp, "admin mark-paid")
	}
	var markOut struct {
		Results []struct {
			ID string `json:"id"`
			OK bool   `json:"ok"`
		} `json:"results"`
	}
	if err := json.NewDecoder(markResp.Body).Decode(&markOut); err != nil {
		t.Fatalf("decode mark-paid: %v", err)
	}
	if len(markOut.Results) != 1 || !markOut.Results[0].OK {
		t.Fatalf("mark-paid harus ok:true buat item itemID, dapat %+v", markOut.Results)
	}

	billBAfter := getMyBill(t, base, payerB.token, clubID)
	if billBAfter.TotalOwed != 0 {
		t.Fatalf("sesudah mark-paid, bill B harus 0, dapat %d", billBAfter.TotalOwed)
	}
}
