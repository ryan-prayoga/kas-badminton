// Test F9/3 (PLAN.md §12.1, §14 F9): kuota per klub & per orang, rate
// limit umum. Pola sama f7/f9_public_test.go — Postgres sungguhan.
package httpapi_test

import (
	"net/http"
	"testing"
)

func setQuota(t *testing.T, base, sudoToken, clubID string, patch map[string]any) {
	t.Helper()
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/admin/clubs/"+clubID+"/quotas", sudoToken, patch)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "set quota")
	}
}

func TestQuota_AnggotaPerKlub_BlocksGuestMember(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	// Klub baru sudah punya 1 anggota (admin/pembuatnya) — batasi ke situ.
	setQuota(t, base, sudo.token, club, map[string]any{"anggota_per_klub": 1})

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/members/guest", admin.token,
		map[string]any{"display_name": "Tamu Kelewat Kuota"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, resp, "guest member harusnya kena kuota anggota_per_klub")
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeJSON(t, resp, &body)
	if body.Error.Code != "quota_exceeded" {
		t.Fatalf("error.code = %q, mau quota_exceeded", body.Error.Code)
	}
}

func TestQuota_AnggotaPerKlub_UnlimitedWhenZero(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	setQuota(t, base, sudo.token, club, map[string]any{"anggota_per_klub": 0})

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/members/guest", admin.token,
		map[string]any{"display_name": "Tamu Bebas Kuota"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "anggota_per_klub=0 harusnya berarti tak terbatas")
	}
}

func TestQuota_PosterAktif_BlocksNewPosterLinkNotJoinLink(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	setQuota(t, base, sudo.token, club, map[string]any{"poster_aktif": 1})

	first := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token, map[string]any{"purpose": "poster"})
	defer first.Body.Close()
	if first.StatusCode != http.StatusCreated {
		dumpAndFail(t, first, "poster pertama")
	}

	second := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token, map[string]any{"purpose": "poster"})
	defer second.Body.Close()
	if second.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, second, "poster kedua harusnya kena kuota poster_aktif")
	}

	// Tautan "join" (bukan poster) TIDAK ikut kuota poster — tetap lolos.
	joinLink := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token, map[string]any{"purpose": "join"})
	defer joinLink.Body.Close()
	if joinLink.StatusCode != http.StatusCreated {
		dumpAndFail(t, joinLink, "tautan join tidak boleh ikut kena kuota poster_aktif")
	}
}

func TestQuota_TournamentGuest_BlockedByMemberQuota(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	outsider := otpLogin(t, base, notifier, randPhone())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	setQuota(t, base, sudo.token, club, map[string]any{"anggota_per_klub": 1})

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/tournaments", admin.token, map[string]any{
		"name": "Turnamen Kuota", "starts_on": "2026-08-08",
		"format": "knockout", "size": 2, "fee": 0,
		"pairs": []map[string]any{{"slot": 0, "a": outsider.userID}},
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, resp, "peserta luar klub harusnya kena kuota anggota_per_klub")
	}
}

func TestQuota_ClaimApprove_BlockedByMemberQuota(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	requester := otpLogin(t, base, notifier, randPhone())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	claimResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/claim-requests", requester.token, map[string]any{})
	defer claimResp.Body.Close()
	if claimResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, claimResp, "ajukan klaim")
	}
	var claim struct {
		ID string `json:"id"`
	}
	decodeJSON(t, claimResp, &claim)

	setQuota(t, base, sudo.token, club, map[string]any{"anggota_per_klub": 1})

	approveResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/claim-requests/"+claim.ID+"/approve", admin.token, nil)
	defer approveResp.Body.Close()
	if approveResp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, approveResp, "approve klaim harusnya kena kuota anggota_per_klub, dan klaim TIDAK boleh ikut ter-approve")
	}

	// Klaim harus TETAP pending — bukan ke-approve tanpa membership sungguhan.
	pending := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/claim-requests", admin.token, nil)
	defer pending.Body.Close()
	var list []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	decodeJSON(t, pending, &list)
	found := false
	for _, c := range list {
		if c.ID == claim.ID {
			found = true
			if c.Status != "pending" {
				t.Fatalf("status klaim = %q, mau tetap pending (approve digagalkan kuota)", c.Status)
			}
		}
	}
	if !found {
		t.Fatal("klaim yang gagal di-approve karena kuota harusnya tetap di antrean pending")
	}
}

func TestQuota_ClubsPerUser_BlocksNewClubPastLimit(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	user := otpLogin(t, base, notifier, randPhone())

	// platformMaxClubsPerUser = 20 (quota.go) — konstanta, tidak bisa
	// digeser lewat API di F9/3 (lihat komentarnya). Bikin 20 klub dulu,
	// yang ke-21 harus ditolak.
	for i := 0; i < 20; i++ {
		resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs", user.token,
			map[string]string{"slug": randSlug(), "name": "Klub Kuota"})
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			dumpAndFail(t, resp, "bikin klub sebelum batas kuota")
		}
	}

	over := authedRequest(t, http.MethodPost, base+"/api/v1/clubs", user.token,
		map[string]string{"slug": randSlug(), "name": "Klub Ke-21"})
	defer over.Body.Close()
	if over.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, over, "klub ke-21 harusnya kena kuota klub_per_orang")
	}
}
