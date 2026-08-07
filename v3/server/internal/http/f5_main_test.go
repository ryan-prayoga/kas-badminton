// Test F5/5 — Main: skor opsional (§8.3), batalkan cepat (§9.4), sanggahan
// (§9.4), pemain tamu (§8.1). Butuh Postgres sungguhan seperti f2_test.go.
package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type gameFullResp struct {
	ID          string  `json:"id"`
	ScoreFormat *string `json:"score_format"`
	WinnerSide  *string `json:"winner_side"`
	Score       []struct {
		GameNo int `json:"game_no"`
		A      int `json:"a"`
		B      int `json:"b"`
	} `json:"score"`
}

func twoPlayerGameBody(userA, userB string, score any) map[string]any {
	body := map[string]any{
		"played_on": "2026-08-08",
		"format":    "single",
		"players": []map[string]any{
			{"user_id": userA, "side": "a", "slot": 1},
			{"user_id": userB, "side": "b", "slot": 1},
		},
	}
	if score != nil {
		body["score"] = score
	}
	return body
}

func TestCreateGame_WithScore_ComputesWinnerAndPersists(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	score := map[string]any{
		"format": "rally42",
		"games":  []map[string]int{{"a": 42, "b": 38}},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", admin.token,
		twoPlayerGameBody(admin.userID, lawan.userID, score))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create game dengan skor")
	}
	var out gameFullResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.ScoreFormat == nil || *out.ScoreFormat != "rally42" {
		t.Fatalf("score_format = %v, mau rally42", out.ScoreFormat)
	}
	if out.WinnerSide == nil || *out.WinnerSide != "a" {
		t.Fatalf("winner_side = %v, mau a (42 > 38)", out.WinnerSide)
	}
	if len(out.Score) != 1 || out.Score[0].A != 42 || out.Score[0].B != 38 {
		t.Fatalf("score tersimpan salah: %+v", out.Score)
	}

	// GET ulang — winner & score harus persisten, bukan cuma di response create.
	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/games/"+out.ID, admin.token, nil)
	defer getResp.Body.Close()
	var got gameFullResp
	_ = json.NewDecoder(getResp.Body).Decode(&got)
	if got.WinnerSide == nil || *got.WinnerSide != "a" {
		t.Fatalf("GET ulang winner_side = %v, mau a", got.WinnerSide)
	}
}

func TestCreateGame_SkorSeriDitolak(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	score := map[string]any{"format": "single", "games": []map[string]int{{"a": 21, "b": 21}}}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", admin.token,
		twoPlayerGameBody(admin.userID, lawan.userID, score))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, resp, "skor seri harusnya ditolak validasi")
	}
}

func TestUndoGame_DalamJendela_MenghapusMainTotal(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	created := createGame(t, base, admin.token, club, admin.userID)

	undoResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games/"+created.ID+"/undo", admin.token, nil)
	defer undoResp.Body.Close()
	if undoResp.StatusCode != http.StatusOK {
		dumpAndFail(t, undoResp, "undo dalam jendela 8 detik")
	}

	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/games/"+created.ID, admin.token, nil)
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET main setelah undo = %d, mau 404 (hard-deleted, bukan soft)", getResp.StatusCode)
	}
}

func TestUndoGame_BukanPencatat_Ditolak(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lain := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lain.userID, gen.ClubRoleMember)

	created := createGame(t, base, admin.token, club, admin.userID)

	undoResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games/"+created.ID+"/undo", lain.token, nil)
	defer undoResp.Body.Close()
	if undoResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, undoResp, "undo oleh bukan pencatat harusnya ditolak")
	}
	if got := errorCode(t, undoResp); got != "insufficient_permission" {
		t.Fatalf("kode galat = %q, mau insufficient_permission", got)
	}

	// Main aslinya harus TETAP ADA — ditolak berarti tidak berefek sama sekali.
	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/games/"+created.ID, admin.token, nil)
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatal("main harusnya tetap ada setelah undo ditolak")
	}
}

// --- sanggahan (§9.4) --- billResp/getMyBill dipakai bersama f8_test.go.

func TestDisputeGamePlayer_MenahanTagihan_ResolveMengembalikan(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	korban := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, korban.userID, gen.ClubRoleMember)

	// Kok berbayar supaya ada tagihan nyata buat "korban" — payer default
	// dirinya sendiri (payer_id tidak disebut di body).
	body := map[string]any{
		"played_on": "2026-08-08",
		"format":    "single",
		"players": []map[string]any{
			{"user_id": admin.userID, "side": "a", "slot": 1},
			{"user_id": korban.userID, "side": "b", "slot": 1},
		},
		"koks": []map[string]any{{"type_name": "Kok", "price_per_person": 6000, "qty": 1}},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", admin.token, body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create game berbayar")
	}
	var game gameFullResp
	_ = json.NewDecoder(resp.Body).Decode(&game)

	before := getMyBill(t, base, korban.token, club)
	if before.TotalOwed == 0 {
		t.Fatal("korban harusnya punya tagihan sebelum menyanggah")
	}

	// Korban menyanggah barisnya sendiri — HAK PEMAIN (user_id), bukan admin.
	disputeResp := authedRequest(t, http.MethodPost,
		base+"/api/v1/clubs/"+club+"/games/"+game.ID+"/players/"+korban.userID+"/dispute",
		korban.token, map[string]string{"note": "aku gak ikut main ini"})
	defer disputeResp.Body.Close()
	if disputeResp.StatusCode != http.StatusOK {
		dumpAndFail(t, disputeResp, "dispute")
	}

	afterDispute := getMyBill(t, base, korban.token, club)
	if afterDispute.TotalOwed != 0 {
		t.Fatalf("tagihan yang disanggah harusnya tidak ikut total_owed, got %d", afterDispute.TotalOwed)
	}

	// Orang lain (bukan dirinya) tidak boleh menyanggah baris korban.
	forbiddenResp := authedRequest(t, http.MethodPost,
		base+"/api/v1/clubs/"+club+"/games/"+game.ID+"/players/"+admin.userID+"/dispute",
		korban.token, map[string]string{"note": "coba sanggah punya orang"})
	defer forbiddenResp.Body.Close()
	if forbiddenResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, forbiddenResp, "sanggah baris orang lain harusnya ditolak")
	}

	// Admin (pencatat) menyelesaikan sanggahan — tagihan kembali normal.
	resolveResp := authedRequest(t, http.MethodPost,
		base+"/api/v1/clubs/"+club+"/games/"+game.ID+"/players/"+korban.userID+"/resolve-dispute",
		admin.token, nil)
	defer resolveResp.Body.Close()
	if resolveResp.StatusCode != http.StatusOK {
		dumpAndFail(t, resolveResp, "resolve-dispute")
	}

	afterResolve := getMyBill(t, base, korban.token, club)
	if afterResolve.TotalOwed != before.TotalOwed {
		t.Fatalf("setelah resolve, total_owed = %d, mau kembali ke %d", afterResolve.TotalOwed, before.TotalOwed)
	}
}

// --- pemain tamu (§8.1) ---

func TestCreateGuestMember_BisaLangsungIkutMainDanDitagih(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	guestResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/members/guest", admin.token,
		map[string]string{"display_name": "Tamu GOR"})
	defer guestResp.Body.Close()
	if guestResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, guestResp, "create guest member")
	}
	var guest struct {
		UserID string `json:"user_id"`
		Status string `json:"status"`
	}
	_ = json.NewDecoder(guestResp.Body).Decode(&guest)
	if guest.Status != "unclaimed" {
		t.Fatalf("status pemain tamu = %q, mau unclaimed", guest.Status)
	}

	// Langsung bisa dicatat sebagai pemain di satu main, persis anggota biasa.
	gameResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", admin.token,
		twoPlayerGameBody(admin.userID, guest.UserID, nil))
	defer gameResp.Body.Close()
	if gameResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, gameResp, "catat main dengan pemain tamu")
	}

	// Muncul di daftar anggota klub (bisa dicari, ditagih, direkap).
	membersResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/members?q=Tamu", admin.token, nil)
	defer membersResp.Body.Close()
	var members []struct {
		UserID string `json:"user_id"`
	}
	_ = json.NewDecoder(membersResp.Body).Decode(&members)
	found := false
	for _, m := range members {
		if m.UserID == guest.UserID {
			found = true
		}
	}
	if !found {
		t.Fatal("pemain tamu harusnya muncul di daftar anggota klub")
	}
}
