// Test F7 lanjutan (PLAN.md §14, §8.3, §8.4): papan peringkat, taruhan
// barang, taruhan kok (settle-bet). Pola sama f5/f6/f7_tournament_test.go
// — Postgres sungguhan.
package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type leaderboardRowResp struct {
	UserID           string `json:"user_id"`
	Name             string `json:"name"`
	Played           int    `json:"played"`
	Won              int    `json:"won"`
	Lost             int    `json:"lost"`
	CurrentStreak    int    `json:"current_streak"`
	LongestWinStreak int    `json:"longest_win_streak"`
}

func scoreBody(a, b int) map[string]any {
	return map[string]any{"format": "single", "games": []map[string]int{{"a": a, "b": b}}}
}

// TestLeaderboard_RanksWinnerAboveLoser — dua main berskor antara dua
// orang, yang menang dua kali harus naik ke atas dgn streak +2.
func TestLeaderboard_RanksWinnerAboveLoser(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	createGameWithBody(t, base, admin.token, club, twoPlayerGameBody(admin.userID, lawan.userID, scoreBody(21, 15)))
	createGameWithBody(t, base, admin.token, club, twoPlayerGameBody(admin.userID, lawan.userID, scoreBody(21, 10)))
	// Satu main tanpa skor — tidak boleh ikut kehitung.
	createGame(t, base, admin.token, club, admin.userID)

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/leaderboard", admin.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "get leaderboard")
	}
	var out struct {
		Season string               `json:"season"`
		Rows   []leaderboardRowResp `json:"rows"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Rows) != 2 {
		t.Fatalf("baris leaderboard = %d, mau 2", len(out.Rows))
	}
	if out.Rows[0].UserID != admin.userID || out.Rows[0].Won != 2 || out.Rows[0].Played != 2 {
		t.Fatalf("baris teratas salah: %+v", out.Rows[0])
	}
	if out.Rows[0].CurrentStreak != 2 {
		t.Fatalf("current_streak = %d, mau 2", out.Rows[0].CurrentStreak)
	}
	if out.Rows[1].UserID != lawan.userID || out.Rows[1].Lost != 2 {
		t.Fatalf("baris kedua salah: %+v", out.Rows[1])
	}
}

// TestLeaderboard_DisabledReturns404 — saklar papan_peringkat dimatikan
// → 404, bukan daftar kosong (§0 API.md, klien harus tahu fiturnya mati).
func TestLeaderboard_DisabledReturns404(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	settingsReq, err := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings", bytes.NewReader(mustJSON(map[string]any{"papan_peringkat": false})))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	settingsReq.Header.Set("Authorization", "Bearer "+admin.token)
	settingsReq.Header.Set("Content-Type", "application/json")
	settingsReq.Header.Set("Idempotency-Key", uuid.NewString())
	settingsReq.Header.Set("If-Match", "1")
	settingsResp, err := http.DefaultClient.Do(settingsReq)
	if err != nil {
		t.Fatalf("patch settings: %v", err)
	}
	defer settingsResp.Body.Close()
	if settingsResp.StatusCode != http.StatusOK {
		dumpAndFail(t, settingsResp, "matikan papan peringkat")
	}

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/leaderboard", admin.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, resp, "leaderboard mati harusnya 404")
	}
}

type sideBetResp struct {
	ID         string `json:"id"`
	DebtorID   string `json:"debtor_id"`
	CreditorID string `json:"creditor_id"`
	Item       string `json:"item"`
	Status     string `json:"status"`
}

// TestSideBet_CreateListAndSettle — catat taruhan barang, muncul di
// daftar open, ditandai lunas oleh yang ditunggu (creditor).
func TestSideBet_CreateListAndSettle(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/side-bets", admin.token, map[string]any{
		"debtor_id": lawan.userID, "creditor_id": admin.userID, "item": "2 Pocari",
	})
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create side bet")
	}
	var bet sideBetResp
	_ = json.NewDecoder(resp.Body).Decode(&bet)
	defer resp.Body.Close()
	if bet.Status != "open" || bet.Item != "2 Pocari" {
		t.Fatalf("side bet salah: %+v", bet)
	}

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/side-bets?open=true", admin.token, nil)
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		dumpAndFail(t, listResp, "list side bets")
	}
	var listed struct {
		Items []sideBetResp `json:"items"`
	}
	_ = json.NewDecoder(listResp.Body).Decode(&listed)
	if len(listed.Items) != 1 || listed.Items[0].ID != bet.ID {
		t.Fatalf("daftar taruhan open salah: %+v", listed.Items)
	}

	// Debtor (yang berutang) MENOLAK bisa mengubah status juga (dua-duanya
	// pihak terlibat) — di sini creditor yang menandai lunas.
	patchResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/side-bets/"+bet.ID, admin.token,
		map[string]any{"status": "settled"})
	defer patchResp.Body.Close()
	if patchResp.StatusCode != http.StatusOK {
		dumpAndFail(t, patchResp, "settle side bet")
	}
	var settled sideBetResp
	_ = json.NewDecoder(patchResp.Body).Decode(&settled)
	if settled.Status != "settled" {
		t.Fatalf("status = %q, mau settled", settled.Status)
	}

	// Orang di luar taruhan ini DITOLAK mengubah statusnya.
	outsider := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, outsider.userID, gen.ClubRoleMember)
	bet2Resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/side-bets", admin.token, map[string]any{
		"debtor_id": lawan.userID, "creditor_id": admin.userID, "item": "1 gorengan",
	})
	defer bet2Resp.Body.Close()
	var bet2 sideBetResp
	_ = json.NewDecoder(bet2Resp.Body).Decode(&bet2)
	forbiddenResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/side-bets/"+bet2.ID, outsider.token,
		map[string]any{"status": "cancelled"})
	defer forbiddenResp.Body.Close()
	if forbiddenResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, forbiddenResp, "orang luar taruhan harusnya ditolak")
	}
}

// TestSettleBet_MovesAllPayerIDsToFirstLoser — "yang kalah bayar kok":
// payer_id semua baris pindah ke pemain pertama sisi kalah.
func TestSettleBet_MovesAllPayerIDsToFirstLoser(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	game := createGameWithBody(t, base, admin.token, club,
		twoPlayerGameBody(admin.userID, lawan.userID, scoreBody(21, 10))) // admin (a) menang

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games/"+game.ID+"/settle-bet", admin.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "settle-bet")
	}
	var out struct {
		Players []struct {
			UserID  string `json:"user_id"`
			PayerID string `json:"payer_id"`
		} `json:"players"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Players) != 2 {
		t.Fatalf("players = %d, mau 2", len(out.Players))
	}
	for _, p := range out.Players {
		if p.PayerID != lawan.userID {
			t.Fatalf("payer_id %s = %s, mau semua ke %s (sisi kalah)", p.UserID, p.PayerID, lawan.userID)
		}
	}
}
