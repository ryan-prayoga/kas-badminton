// Test F9/1 (PLAN.md §14 F9, §6.3): halaman publik klub. Pola sama
// f6/f7_test.go — Postgres sungguhan. Fokus dua hal: gerbang saklar
// (halaman_publik, transparansi_kas, papan_peringkat) balas 404 yang
// sama-sama tidak bisa dibedakan dari "klub tidak ada", dan angkanya
// cocok dengan endpoint anggota yang setara TANPA membocorkan field
// privat (nomor telepon, saldo deposit perorangan).
package httpapi_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func getPublicClub(t *testing.T, base, slug string) *http.Response {
	t.Helper()
	return doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug, "", "", nil)
}

func decodeJSON(t *testing.T, resp *http.Response, out any) {
	t.Helper()
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
}

// patchSettingsOnce — klub baru selalu version=1, jadi If-Match "1" aman
// dipakai satu kali (pola sama TestClubSettings_PatchAndVersionConflict,
// f6_test.go). Test di berkas ini pakai ini MAKSIMAL sekali per klub;
// yang butuh patch kedua kali menyusun http.NewRequest sendiri dgn
// If-Match "2".
func patchSettingsOnce(t *testing.T, base, token, clubID string, patch map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+clubID+"/settings", strings.NewReader(string(mustJSON(patch))))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("If-Match", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch settings: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "patch settings")
	}
}

func TestPublicClub_OffByDefault_404(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	createClub(t, base, admin.token, slug)

	resp := getPublicClub(t, base, slug)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, resp, "halaman publik klub baru (halaman_publik belum dinyalakan) harus 404")
	}
}

func TestPublicClub_UnknownSlug_404(t *testing.T) {
	srv, _ := newTestServer(t)
	base := srv.URL

	resp := getPublicClub(t, base, "klub-yang-tidak-ada-"+randSlug())
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, resp, "slug tidak dikenal harus 404")
	}
}

func TestPublicClub_InfoAndStats(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true})

	resp := getPublicClub(t, base, slug)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET halaman publik klub setelah dinyalakan")
	}
	var got struct {
		Slug            string `json:"slug"`
		Name            string `json:"name"`
		TransparansiKas bool   `json:"transparansi_kas"`
		PapanPeringkat  bool   `json:"papan_peringkat"`
		MemberCount     int64  `json:"member_count"`
	}
	decodeJSON(t, resp, &got)
	if got.Slug != slug {
		t.Fatalf("slug = %q, mau %q", got.Slug, slug)
	}
	if got.MemberCount != 2 {
		t.Fatalf("member_count = %d, mau 2 (admin+member)", got.MemberCount)
	}
	if !got.TransparansiKas || !got.PapanPeringkat {
		t.Fatalf("saklar bawaan (transparansi_kas, papan_peringkat) harusnya nyala, dapat %+v", got)
	}
}

// TestPublicClub_NeverLeaksPhoneOrSettings — sengaja membaca body MENTAH
// (bukan decode ke struct) supaya field yang TIDAK didefinisikan di
// publicClubDTO tetap ketahuan kalau suatu saat ada yang iseng nempel
// balik newClubDTO/settings mentah ke sini (§6.3 "tidak pernah tampil ...
// pengaturan").
func TestPublicClub_NeverLeaksPhoneOrSettings(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()
	admin := otpLogin(t, base, notifier, phone)
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)
	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true})

	resp := getPublicClub(t, base, slug)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("baca body: %v", err)
	}
	body := string(raw)
	for _, forbidden := range []string{phone, "\"settings\"", "\"tunggakan_minimal\"", "\"siapa_boleh_catat\""} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("respons halaman publik memuat %q — seharusnya tidak pernah. body: %s", forbidden, body)
		}
	}
}

func TestPublicTreasury_GatedBySwitch(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// halaman_publik nyala, transparansi_kas MATI (bawaannya nyala,
	// dimatikan eksplisit di sini) — publik tidak boleh lihat kas sama
	// sekali, beda dari anggota yang masih bisa lewat ManageMoney.
	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true, "transparansi_kas": false})

	off := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/treasury", "", "", nil)
	defer off.Body.Close()
	if off.StatusCode != http.StatusNotFound {
		dumpAndFail(t, off, "treasury publik dgn transparansi_kas mati harus 404")
	}

	// Main + lunas → kas klub bertambah (pola treasury_test.go).
	game := createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 10000))
	markResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/bills/mark-paid", admin.token,
		map[string]any{"item_ids": []string{game.Players[0].ID}})
	defer markResp.Body.Close()
	if markResp.StatusCode != http.StatusOK {
		dumpAndFail(t, markResp, "mark-paid")
	}

	_, memberView := getTreasury(t, base, admin.token, club)

	turnOnReq, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings", strings.NewReader(string(mustJSON(map[string]any{"transparansi_kas": true}))))
	turnOnReq.Header.Set("Authorization", "Bearer "+admin.token)
	turnOnReq.Header.Set("Content-Type", "application/json")
	turnOnReq.Header.Set("Idempotency-Key", uuid.NewString())
	turnOnReq.Header.Set("If-Match", "2") // patch pertama (halaman_publik+transparansi_kas) sudah menaikkan ke 2
	turnOnResp, err := http.DefaultClient.Do(turnOnReq)
	if err != nil {
		t.Fatalf("patch nyalakan transparansi_kas: %v", err)
	}
	defer turnOnResp.Body.Close()
	if turnOnResp.StatusCode != http.StatusOK {
		dumpAndFail(t, turnOnResp, "nyalakan transparansi_kas")
	}

	on := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/treasury", "", "", nil)
	defer on.Body.Close()
	if on.StatusCode != http.StatusOK {
		dumpAndFail(t, on, "treasury publik setelah transparansi_kas dinyalakan")
	}
	var got struct {
		KasKlub int64 `json:"kas_klub"`
	}
	decodeJSON(t, on, &got)
	if got.KasKlub != memberView.KasKlub {
		t.Fatalf("kas_klub publik = %d, mau sama dgn punya anggota = %d", got.KasKlub, memberView.KasKlub)
	}
}

func TestPublicBills_AggregatePerName(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)
	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true})

	createGameWithBody(t, base, member.token, club, gameBodyWithKok(member.userID, 12000))

	resp := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/bills", "", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET bills publik")
	}
	var got struct {
		Items []struct {
			UserID      string `json:"user_id"`
			DisplayName string `json:"display_name"`
			TotalOwed   int64  `json:"total_owed"`
		} `json:"items"`
	}
	decodeJSON(t, resp, &got)
	var found bool
	for _, item := range got.Items {
		if item.UserID == member.userID {
			found = true
			if item.TotalOwed != 12000 {
				t.Fatalf("total_owed = %d, mau 12000", item.TotalOwed)
			}
		}
	}
	if !found {
		t.Fatal("member dgn tagihan belum lunas tidak muncul di rekap publik")
	}
}

func TestPublicLeaderboard_GatedBySwitch(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)

	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true, "papan_peringkat": false})

	resp := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/leaderboard", "", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, resp, "leaderboard publik dgn saklar mati harus 404")
	}
}

func TestPublicTournament_ListAndGet(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	slug := randSlug()
	club := createClub(t, base, admin.token, slug)
	patchSettingsOnce(t, base, admin.token, club, map[string]any{"halaman_publik": true})

	created := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, map[string]any{
		"name": "Turnamen Publik", "starts_on": time.Now().Format("2006-01-02"),
		"format": "knockout", "size": 2, "fee": 5000,
		"pairs": []map[string]any{{"slot": 0, "a": admin.userID}},
	})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		dumpAndFail(t, created, "create tournament")
	}
	var tour struct {
		ID string `json:"id"`
	}
	decodeJSON(t, created, &tour)

	list := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/tournaments", "", "", nil)
	defer list.Body.Close()
	if list.StatusCode != http.StatusOK {
		dumpAndFail(t, list, "list tournaments publik")
	}
	var listGot struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	decodeJSON(t, list, &listGot)
	var found bool
	for _, it := range listGot.Items {
		if it.ID == tour.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("turnamen baru tidak muncul di daftar turnamen publik")
	}

	get := doRequest(t, http.MethodGet, base+"/api/v1/public/clubs/"+slug+"/tournaments/"+tour.ID, "", "", nil)
	defer get.Body.Close()
	if get.StatusCode != http.StatusOK {
		dumpAndFail(t, get, "get tournament publik")
	}
}
