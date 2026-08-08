// Test F7 (PLAN.md §14, API.md §5): turnamen — bagan, skor, kok umum &
// per-partai (lubang kok lepas v2 tertutup), iuran, tamu turnamen. Pola
// sama f2/f4/f6_test.go — Postgres sungguhan.
package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

type tournamentTestParticipant struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
}

type tournamentTestPair struct {
	ID   string                     `json:"id"`
	Slot int                        `json:"slot"`
	A    *tournamentTestParticipant `json:"a"`
	B    *tournamentTestParticipant `json:"b"`
}

type tournamentTestMatch struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Round int    `json:"round"`
	Index int    `json:"index"`
	A     struct {
		Pair *tournamentTestPair `json:"pair"`
		Bye  bool                `json:"bye"`
	} `json:"a"`
	B struct {
		Pair *tournamentTestPair `json:"pair"`
		Bye  bool                `json:"bye"`
	} `json:"b"`
	Winner   string `json:"winner"`
	AutoWin  bool   `json:"auto_win"`
	KokTotal int64  `json:"kok_total"`
}

type tournamentTestRound struct {
	Round   int                   `json:"round"`
	Label   string                `json:"label"`
	Matches []tournamentTestMatch `json:"matches"`
}

type tournamentTestFee struct {
	UserID string     `json:"user_id"`
	Name   string     `json:"name"`
	Amount int64      `json:"amount"`
	PaidAt *time.Time `json:"paid_at"`
}

type tournamentTestKokCharge struct {
	ID      string     `json:"id"`
	MatchID string     `json:"match_id"`
	UserID  string     `json:"user_id"`
	Amount  int64      `json:"amount"`
	PaidAt  *time.Time `json:"paid_at"`
}

type tournamentTestCost struct {
	KokTotal  int64 `json:"kok_total"`
	KokPaid   int64 `json:"kok_paid"`
	FeeTotal  int64 `json:"fee_total"`
	FeePaid   int64 `json:"fee_paid"`
	FeeUnpaid int64 `json:"fee_unpaid"`
}

type tournamentTestResp struct {
	ID         string                    `json:"id"`
	Status     string                    `json:"status"`
	Version    int64                     `json:"version"`
	Format     string                    `json:"format"`
	Pairs      []tournamentTestPair      `json:"pairs"`
	Rounds     []tournamentTestRound     `json:"rounds"`
	Matches    []tournamentTestMatch     `json:"matches"`
	Champion   *tournamentTestPair       `json:"champion"`
	Finished   bool                      `json:"finished"`
	Fees       []tournamentTestFee       `json:"fees"`
	KokCharges []tournamentTestKokCharge `json:"kok_charges"`
	Cost       tournamentTestCost        `json:"cost"`
}

func decodeTournament(t *testing.T, resp *http.Response) tournamentTestResp {
	t.Helper()
	defer resp.Body.Close()
	var out tournamentTestResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode tournament: %v", err)
	}
	return out
}

// TestTournament_Knockout_ScoreAndChampion — bagan 2 pasangan (final
// langsung, tanpa BYE): isi skor, pastikan pemenang & champion kehitung
// benar, dan iuran otomatis dibuat per peserta saat turnamen dibuat.
func TestTournament_Knockout_ScoreAndChampion(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	p1a := otpLogin(t, base, notifier, randPhone())
	p1b := otpLogin(t, base, notifier, randPhone())
	p2a := otpLogin(t, base, notifier, randPhone())
	p2b := otpLogin(t, base, notifier, randPhone())
	for _, u := range []loggedInUser{p1a, p1b, p2a, p2b} {
		addMembershipRole(t, club, u.userID)
	}

	body := map[string]any{
		"name": "Turnamen Agustusan", "starts_on": time.Now().Format("2006-01-02"),
		"format": "knockout", "size": 2, "fee": 10000,
		"pairs": []map[string]any{
			{"slot": 0, "a": p1a.userID, "b": p1b.userID},
			{"slot": 1, "a": p2a.userID, "b": p2b.userID},
		},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, body)
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create tournament")
	}
	created := decodeTournament(t, resp)
	if created.Status == "" {
		t.Fatalf("status turnamen kosong")
	}
	if len(created.Fees) != 4 {
		t.Fatalf("fees = %d baris, mau 4 (satu per peserta)", len(created.Fees))
	}
	for _, f := range created.Fees {
		if f.Amount != 10000 {
			t.Fatalf("iuran %s = %d, mau 10000", f.Name, f.Amount)
		}
		if f.PaidAt != nil {
			t.Fatalf("iuran %s harusnya belum lunas saat baru dibuat", f.Name)
		}
	}
	if len(created.Rounds) != 1 || len(created.Rounds[0].Matches) != 1 {
		t.Fatalf("bagan 2 pasangan harusnya 1 babak 1 partai, dapat %+v", created.Rounds)
	}
	matchID := created.Rounds[0].Matches[0].ID

	scoreBody := map[string]any{
		"format": "single",
		"games":  []map[string]any{{"a": 21, "b": 15}},
	}
	scoreURL := base + "/api/v1/clubs/" + club + "/tournaments/" + created.ID + "/matches/" + matchID + "/score"
	sresp := authedRequest(t, http.MethodPost, scoreURL, admin.token, scoreBody)
	if sresp.StatusCode != http.StatusOK {
		dumpAndFail(t, sresp, "score match")
	}
	scored := decodeTournament(t, sresp)
	if !scored.Finished {
		t.Fatalf("turnamen final tunggal harusnya selesai begitu skornya masuk")
	}
	if scored.Champion == nil || scored.Champion.A == nil || scored.Champion.A.UserID != p1a.userID {
		t.Fatalf("champion salah: %+v (mau pasangan p1a=%s)", scored.Champion, p1a.userID)
	}
	if scored.Rounds[0].Matches[0].Winner != "a" {
		t.Fatalf("winner partai = %q, mau \"a\"", scored.Rounds[0].Matches[0].Winner)
	}
}

// TestTournament_KokUmum_ChargesAllParticipants — kok umum harus dibagi
// rata ke SEMUA peserta turnamen dan masing-masing dapat baris tagihan
// (menutup lubang kok lepas v2, PLAN.md §14 F7 "selesai kalau").
func TestTournament_KokUmum_ChargesAllParticipants(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	p1 := otpLogin(t, base, notifier, randPhone())
	p2 := otpLogin(t, base, notifier, randPhone())
	addMembershipRole(t, club, p1.userID)
	addMembershipRole(t, club, p2.userID)

	body := map[string]any{
		"name": "RR Kecil", "starts_on": time.Now().Format("2006-01-02"),
		"format": "round_robin", "size": 2, "fee": 0,
		"pairs": []map[string]any{
			{"slot": 0, "a": admin.userID},
			{"slot": 1, "a": p1.userID},
		},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, body)
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create tournament")
	}
	created := decodeTournament(t, resp)

	kokBody := map[string]any{"type_name": "Kok tarkam", "price_per_person": 10000, "qty": 1}
	kresp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments/"+created.ID+"/koks", admin.token, kokBody)
	if kresp.StatusCode != http.StatusOK {
		dumpAndFail(t, kresp, "kok umum")
	}
	after := decodeTournament(t, kresp)
	if len(after.KokCharges) != 2 {
		t.Fatalf("kok charges = %d, mau 2 (satu per peserta)", len(after.KokCharges))
	}
	var total int64
	for _, c := range after.KokCharges {
		if c.MatchID != "" {
			t.Fatalf("kok umum harusnya match_id kosong, dapat %q", c.MatchID)
		}
		total += c.Amount
	}
	if total < 10000 {
		t.Fatalf("total kok charges = %d, mau >= 10000", total)
	}
	if after.Cost.KokTotal != 10000 {
		t.Fatalf("cost.kok_total = %d, mau 10000", after.Cost.KokTotal)
	}

	ids := make([]string, len(after.KokCharges))
	for i, c := range after.KokCharges {
		ids[i] = c.ID
	}
	markURL := base + "/api/v1/clubs/" + club + "/tournaments/" + created.ID + "/kok-charges/mark-paid"
	mresp := authedRequest(t, http.MethodPost, markURL, admin.token, map[string]any{"ids": ids})
	if mresp.StatusCode != http.StatusOK {
		dumpAndFail(t, mresp, "mark kok charges paid")
	}
	var markOut struct {
		Results []struct {
			OK bool `json:"ok"`
		} `json:"results"`
		Tournament tournamentTestResp `json:"tournament"`
	}
	_ = json.NewDecoder(mresp.Body).Decode(&markOut)
	if len(markOut.Results) != 2 || !markOut.Results[0].OK || !markOut.Results[1].OK {
		t.Fatalf("hasil mark-paid tidak semua ok: %+v", markOut.Results)
	}
	if markOut.Tournament.Cost.KokPaid != markOut.Tournament.Cost.KokTotal {
		t.Fatalf("cost.kok_paid = %d, mau sama dgn kok_total %d setelah semua ditandai lunas",
			markOut.Tournament.Cost.KokPaid, markOut.Tournament.Cost.KokTotal)
	}
}

// TestTournament_ByeMatch_RejectsPartaiKok — partai BYE (lawan belum ada)
// tidak boleh ditambah kok partai, karena tidak ada 4 orang buat dibagi.
func TestTournament_ByeMatch_RejectsPartaiKok(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	p1 := otpLogin(t, base, notifier, randPhone())
	addMembershipRole(t, club, p1.userID)

	// size=3 dibulatkan ke bagan 4 slot → satu partai babak pertama pasti BYE.
	body := map[string]any{
		"name": "Knockout BYE", "starts_on": time.Now().Format("2006-01-02"),
		"format": "knockout", "size": 3,
		"pairs": []map[string]any{
			{"slot": 0, "a": admin.userID},
			{"slot": 1, "a": p1.userID},
		},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, body)
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create tournament")
	}
	created := decodeTournament(t, resp)

	var byeMatchID string
	for _, m := range created.Rounds[0].Matches {
		if m.A.Bye || m.B.Bye {
			byeMatchID = m.ID
			break
		}
	}
	if byeMatchID == "" {
		t.Fatalf("tidak ada partai BYE di bagan 3 pasangan: %+v", created.Rounds)
	}

	kokURL := base + "/api/v1/clubs/" + club + "/tournaments/" + created.ID + "/matches/" + byeMatchID + "/koks"
	kresp := authedRequest(t, http.MethodPost, kokURL, admin.token, map[string]any{"type_name": "Kok", "price_per_person": 4000, "qty": 1})
	if kresp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, kresp, "kok di partai BYE harusnya ditolak")
	}
}

// TestTournament_GuestPairBecomesTournamentGuestMember — pasangan yang
// user_id-nya BUKAN anggota klub otomatis jadi anggota is_tournament_guest
// (§8.1), bukan gagal atau diam-diam terdaftar sebagai anggota biasa.
func TestTournament_GuestPairBecomesTournamentGuestMember(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	outsider := otpLogin(t, base, notifier, randPhone()) // BELUM addMembershipRole

	body := map[string]any{
		"name": "Turnamen Tamu", "starts_on": time.Now().Format("2006-01-02"),
		"format": "knockout", "size": 2,
		"pairs": []map[string]any{
			{"slot": 0, "a": admin.userID},
			{"slot": 1, "a": outsider.userID},
		},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, body)
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create tournament dgn tamu")
	}

	membersResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/members", admin.token, nil)
	defer membersResp.Body.Close()
	if membersResp.StatusCode != http.StatusOK {
		dumpAndFail(t, membersResp, "list members")
	}
	var members []struct {
		UserID            string `json:"user_id"`
		IsTournamentGuest bool   `json:"is_tournament_guest"`
	}
	_ = json.NewDecoder(membersResp.Body).Decode(&members)
	found := false
	for _, m := range members {
		if m.UserID == outsider.userID {
			found = true
			if !m.IsTournamentGuest {
				t.Fatalf("outsider yang dipasangkan di turnamen harusnya is_tournament_guest=true")
			}
		}
	}
	if !found {
		t.Fatalf("outsider tidak muncul di daftar anggota klub sama sekali")
	}
}

// TestTournament_Patch_VersionConflict — If-Match basi ditolak 409, sama
// pola TestClubSettings_PatchAndVersionConflict (f6_test.go).
func TestTournament_Patch_VersionConflict(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	body := map[string]any{
		"name": "Turnamen Versi", "starts_on": time.Now().Format("2006-01-02"),
		"format": "knockout", "size": 2, "fee": 5000,
		"pairs": []map[string]any{{"slot": 0, "a": admin.userID}},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, body)
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create tournament")
	}
	created := decodeTournament(t, resp)

	patchURL := base + "/api/v1/clubs/" + club + "/tournaments/" + created.ID
	ok := patchWithIfMatch(t, patchURL, admin.token, map[string]any{"fee": 15000}, created.Version)
	if ok.StatusCode != http.StatusOK {
		dumpAndFail(t, ok, "patch fee")
	}

	stale := patchWithIfMatch(t, patchURL, admin.token, map[string]any{"fee": 20000}, created.Version)
	if stale.StatusCode != http.StatusConflict {
		dumpAndFail(t, stale, "patch dgn If-Match basi harusnya 409")
	}
}

func patchWithIfMatch(t *testing.T, url, token string, body map[string]any, version int64) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	httpReq, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(b))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Idempotency-Key", uuid.NewString())
	httpReq.Header.Set("If-Match", strconv.FormatInt(version, 10))
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	return resp
}

// addMembershipRole — pairs cukup jadi anggota apa pun (perannya tidak
// relevan buat test-test ini, yang mencatat turnamen selalu admin).
func addMembershipRole(t *testing.T, clubID, userID string) {
	t.Helper()
	addMembership(t, clubID, userID, gen.ClubRoleMember)
}
