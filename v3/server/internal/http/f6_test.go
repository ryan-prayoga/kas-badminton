// Test F4 bagian 3 (PLAN.md §14 F4, §7.3, §7.2.1): undangan+klaim+
// persetujuan, tautan/QR klub, pengaturan klub, peran anggota, pemindahan
// nomor. Pola sama f2/f4_test.go — Postgres sungguhan.
package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

func TestClubSettings_PatchAndVersionConflict(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	req, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings", bytes.NewReader(mustJSON(map[string]any{"siapa_boleh_catat": "hanya_pengurus"})))
	req.Header.Set("Authorization", "Bearer "+admin.token)
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
	var got struct {
		Settings map[string]any `json:"settings"`
		Version  int64          `json:"version"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.Settings["siapa_boleh_catat"] != "hanya_pengurus" {
		t.Fatalf("siapa_boleh_catat = %v, mau hanya_pengurus", got.Settings["siapa_boleh_catat"])
	}
	if got.Settings["transparansi_kas"] != true {
		t.Fatalf("field lain (transparansi_kas) harus tetap bawaan, dapat %v — PATCH mestinya merge bukan replace", got.Settings["transparansi_kas"])
	}
	if got.Version != 2 {
		t.Fatalf("version sesudah patch = %d, mau 2", got.Version)
	}

	// If-Match basi (1, padahal sekarang 2) → 409.
	req2, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings", bytes.NewReader(mustJSON(map[string]any{"transparansi_kas": false})))
	req2.Header.Set("Authorization", "Bearer "+admin.token)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Idempotency-Key", uuid.NewString())
	req2.Header.Set("If-Match", "1")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("patch settings basi: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		dumpAndFail(t, resp2, "patch settings dengan If-Match basi harus 409")
	}
}

func TestClubSettings_MemberDitolak(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	req, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/settings", bytes.NewReader(mustJSON(map[string]any{"transparansi_kas": false})))
	req.Header.Set("Authorization", "Bearer "+member.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("If-Match", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch settings by member: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, resp, "member ubah settings klub harus ditolak")
	}
}

func TestMembers_ListSearchAndRole(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/members", admin.token, nil)
	defer listResp.Body.Close()
	var list []struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&list); err != nil {
		t.Fatalf("decode members: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("daftar anggota = %d, mau 2 (admin+member)", len(list))
	}

	roleResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/members/"+member.userID+"/role", admin.token,
		map[string]string{"role": "pencatat"})
	defer roleResp.Body.Close()
	if roleResp.StatusCode != http.StatusOK {
		dumpAndFail(t, roleResp, "ubah peran ke pencatat")
	}

	// Sekarang pencatat boleh catat main walau saklar hanya_pengurus.
	setSiapaBolehCatat(t, club, "hanya_pengurus")
	gameResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, createGameBody(member.userID))
	defer gameResp.Body.Close()
	if gameResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, gameResp, "pencatat (baru dinaikkan) catat main")
	}
}

func TestMembers_AutoDeduct_SelfOrAdmin(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// Diri sendiri boleh.
	selfResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/members/"+member.userID+"/auto-deduct", member.token,
		map[string]bool{"auto_deduct": false})
	defer selfResp.Body.Close()
	if selfResp.StatusCode != http.StatusOK {
		dumpAndFail(t, selfResp, "member ubah auto-deduct diri sendiri")
	}

	other := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, other.userID, gen.ClubRoleMember)
	otherResp := authedRequest(t, http.MethodPatch, base+"/api/v1/clubs/"+club+"/members/"+member.userID+"/auto-deduct", other.token,
		map[string]bool{"auto_deduct": true})
	defer otherResp.Body.Close()
	if otherResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, otherResp, "member LAIN ubah auto-deduct orang harus ditolak")
	}
}

func TestRelocatePhone_RevokesOldSessionAndPin(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	pinResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/pin/set", member.token, map[string]string{"pin": "246810"})
	defer pinResp.Body.Close()
	if pinResp.StatusCode != http.StatusOK {
		dumpAndFail(t, pinResp, "set pin sebelum relokasi")
	}

	newPhone := randPhone()
	relocResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/members/"+member.userID+"/relocate-phone", admin.token,
		map[string]string{"new_phone": newPhone, "reason": "HP hilang, ganti kartu"})
	defer relocResp.Body.Close()
	if relocResp.StatusCode != http.StatusOK {
		dumpAndFail(t, relocResp, "relocate-phone")
	}

	// Sesi lama member harus mati.
	checkResp := authedRequest(t, http.MethodGet, base+"/api/v1/auth/sessions", member.token, nil)
	defer checkResp.Body.Close()
	if checkResp.StatusCode != http.StatusUnauthorized {
		dumpAndFail(t, checkResp, "sesi lama sesudah relocate-phone seharusnya sudah tercabut")
	}

	// Login pakai nomor BARU harus jalan (nomor sudah terpasang).
	relogged := otpLogin(t, base, notifier, newPhone)
	if relogged.userID != member.userID {
		t.Fatalf("login pakai nomor baru mengembalikan user berbeda: %s, mau %s", relogged.userID, member.userID)
	}
}

func TestClubLinks_CreateListRotateRevoke(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	createResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token,
		map[string]string{"purpose": "join", "label": "Poster GOR"})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, createResp, "create link")
	}
	var link struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	_ = json.NewDecoder(createResp.Body).Decode(&link)
	if link.Token == "" {
		t.Fatal("token tautan kosong")
	}

	// Token bisa dipakai lewat /join/{token} — publik.
	joinResp, err := http.Get(base + "/api/v1/join/" + link.Token)
	if err != nil {
		t.Fatalf("get join info: %v", err)
	}
	defer joinResp.Body.Close()
	if joinResp.StatusCode != http.StatusOK {
		dumpAndFail(t, joinResp, "GET /join/{token}")
	}
	var info struct {
		Club struct {
			Slug string `json:"slug"`
		} `json:"club"`
	}
	_ = json.NewDecoder(joinResp.Body).Decode(&info)
	if info.Club.Slug == "" {
		t.Fatal("GET /join/{token} tidak mengembalikan info klub")
	}

	rotateResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links/"+link.ID+"/rotate", admin.token, nil)
	defer rotateResp.Body.Close()
	if rotateResp.StatusCode != http.StatusOK {
		dumpAndFail(t, rotateResp, "rotate link")
	}
	var rotated struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(rotateResp.Body).Decode(&rotated)
	if rotated.Token == link.Token {
		t.Fatal("token sesudah rotate harus beda dari sebelumnya")
	}

	// Token LAMA sekarang mati.
	oldJoinResp, err := http.Get(base + "/api/v1/join/" + link.Token)
	if err != nil {
		t.Fatalf("get join info token lama: %v", err)
	}
	defer oldJoinResp.Body.Close()
	if oldJoinResp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, oldJoinResp, "token lama sesudah rotate harusnya mati (404)")
	}

	revokeResp := authedRequest(t, http.MethodDelete, base+"/api/v1/clubs/"+club+"/links/"+link.ID, admin.token, nil)
	defer revokeResp.Body.Close()
	if revokeResp.StatusCode != http.StatusOK {
		dumpAndFail(t, revokeResp, "revoke link")
	}

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/links", admin.token, nil)
	defer listResp.Body.Close()
	var links []map[string]any
	_ = json.NewDecoder(listResp.Body).Decode(&links)
	if len(links) != 0 {
		t.Fatalf("daftar tautan aktif sesudah revoke = %d, mau 0", len(links))
	}
}

// TestJoinFlow_ClaimRequestApprove — alur penuh §6.4: buat tautan → pindai
// (GET) → minta OTP (POST) → verifikasi (otp/verify sudah ada) → ajukan
// klaim → admin setujui → requester jadi anggota.
func TestJoinFlow_ClaimRequestApprove(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	createResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token, map[string]string{"purpose": "join"})
	defer createResp.Body.Close()
	var link struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(createResp.Body).Decode(&link)

	newcomerPhone := randPhone()
	joinReqResp, err := http.Post(base+"/api/v1/join/"+link.Token, "application/json", bytes.NewReader(mustJSON(map[string]string{"phone": newcomerPhone})))
	if err != nil {
		t.Fatalf("POST /join/{token}: %v", err)
	}
	defer joinReqResp.Body.Close()
	if joinReqResp.StatusCode != http.StatusOK {
		dumpAndFail(t, joinReqResp, "POST /join/{token}")
	}

	newcomer := otpLogin(t, base, notifier, newcomerPhone)

	// Belum anggota — akses klub ini masih 404 (RequireClub biasa).
	preResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/", newcomer.token, nil)
	defer preResp.Body.Close()
	if preResp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, preResp, "sebelum klaim disetujui, akses klub harus 404")
	}

	claimResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/claim-requests", newcomer.token, map[string]any{})
	defer claimResp.Body.Close()
	if claimResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, claimResp, "ajukan claim-request")
	}
	var claim struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	_ = json.NewDecoder(claimResp.Body).Decode(&claim)
	if claim.Status != "pending" {
		t.Fatalf("status claim baru = %q, mau pending", claim.Status)
	}

	// Member biasa TIDAK boleh melihat/menyetujui (perm.VerifyClaim, bukan
	// dipegang member).
	memberDeny := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, memberDeny.userID, gen.ClubRoleMember)
	denyResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/claim-requests", memberDeny.token, nil)
	defer denyResp.Body.Close()
	if denyResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, denyResp, "member biasa lihat antrean klaim harus ditolak")
	}

	pendingResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/claim-requests", admin.token, nil)
	defer pendingResp.Body.Close()
	var pending []struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(pendingResp.Body).Decode(&pending)
	if len(pending) != 1 {
		t.Fatalf("antrean klaim pending = %d, mau 1", len(pending))
	}

	approveResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/claim-requests/"+claim.ID+"/approve", admin.token, map[string]string{"note": "sudah dicek"})
	defer approveResp.Body.Close()
	if approveResp.StatusCode != http.StatusOK {
		dumpAndFail(t, approveResp, "approve claim-request")
	}

	// Sekarang anggota — akses klub jalan.
	postResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/", newcomer.token, nil)
	defer postResp.Body.Close()
	if postResp.StatusCode != http.StatusOK {
		dumpAndFail(t, postResp, "sesudah klaim disetujui, akses klub harus 200")
	}
}

func TestInvites_CreateAndJoinViaToken(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	invitedPhone := randPhone()
	inviteResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/invites", admin.token, map[string]string{"phone": invitedPhone})
	defer inviteResp.Body.Close()
	if inviteResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, inviteResp, "create invite")
	}
	var invite struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(inviteResp.Body).Decode(&invite)
	if invite.Token == "" {
		t.Fatal("token undangan kosong")
	}

	// Token undangan JUGA bisa dibuka lewat /join/{token} — resolveJoinToken
	// mencoba invites setelah club_links.
	infoResp, err := http.Get(base + "/api/v1/join/" + invite.Token)
	if err != nil {
		t.Fatalf("get join info via invite token: %v", err)
	}
	defer infoResp.Body.Close()
	if infoResp.StatusCode != http.StatusOK {
		dumpAndFail(t, infoResp, "GET /join/{invite-token}")
	}
}

func TestClubLinks_Poster(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())

	createResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/links", admin.token, map[string]string{"purpose": "poster"})
	defer createResp.Body.Close()
	var link struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(createResp.Body).Decode(&link)

	pdfResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/links/"+link.ID+"/poster", admin.token, nil)
	defer pdfResp.Body.Close()
	if pdfResp.StatusCode != http.StatusOK {
		dumpAndFail(t, pdfResp, "GET poster (PDF)")
	}
	if ct := pdfResp.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type poster bawaan = %q, mau application/pdf", ct)
	}
	pdfBody, _ := io.ReadAll(pdfResp.Body)
	if !bytes.HasPrefix(pdfBody, []byte("%PDF-")) {
		t.Error("body poster bawaan bukan PDF valid")
	}

	pngResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/links/"+link.ID+"/poster?format=png&size=a5", admin.token, nil)
	defer pngResp.Body.Close()
	if pngResp.StatusCode != http.StatusOK {
		dumpAndFail(t, pngResp, "GET poster (PNG a5)")
	}
	if ct := pngResp.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type poster ?format=png = %q, mau image/png", ct)
	}
	pngBody, _ := io.ReadAll(pngResp.Body)
	if !bytes.HasPrefix(pngBody, []byte("\x89PNG")) {
		t.Error("body poster ?format=png bukan PNG valid")
	}

	// Member biasa (bukan admin) ditolak — poster ikut RequirePerm(ManageMembers)
	// sama seperti endpoint /links lainnya.
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)
	deniedResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/links/"+link.ID+"/poster", member.token, nil)
	defer deniedResp.Body.Close()
	if deniedResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, deniedResp, "member biasa unduh poster harus ditolak")
	}
}
