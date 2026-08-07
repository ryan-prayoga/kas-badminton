// Test F4 bagian 1 (PLAN.md §14 F4 "selesai kalau": "pencatat ditolak saat
// menyentuh endpoint uang"; §7.2 alur OTP/PIN/sesi). Pola sama f2_test.go —
// Postgres sungguhan, skip kalau TEST_DATABASE_URL tidak diset.
package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

// --- OTP ---

func TestOTP_WrongCode_ThenCorrect(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()

	otpRequest(t, base, phone, "device")
	code := notifier.codeFor(t, phone)

	wrongResp := otpVerifyRaw(t, base, phone, "000000")
	defer wrongResp.Body.Close()
	if wrongResp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, wrongResp, "verify kode salah")
	}
	if got := errorCode(t, wrongResp); got != "validation_failed" {
		t.Fatalf("kode galat kode-salah = %q, mau validation_failed", got)
	}

	// Kode BENAR masih bisa dipakai sesudahnya — satu kali salah belum
	// menghabiskan percobaan (maks 5, §17).
	rightResp := otpVerifyRaw(t, base, phone, code)
	defer rightResp.Body.Close()
	if rightResp.StatusCode != http.StatusOK {
		dumpAndFail(t, rightResp, "verify kode benar setelah satu kali salah")
	}
}

func TestOTP_MaxAttempts_LocksOutEvenCorrectCode(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()

	otpRequest(t, base, phone, "device")
	code := notifier.codeFor(t, phone)

	for i := 0; i < 5; i++ {
		resp := otpVerifyRaw(t, base, phone, "000000")
		resp.Body.Close()
	}

	// Percobaan ke-6, walau kodenya BENAR, harus ditolak — otp_codes.attempts
	// sudah mentok (§17 "maks 5 percobaan").
	resp := otpVerifyRaw(t, base, phone, code)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, resp, "verify sesudah 5x salah")
	}
	if got := errorCode(t, resp); got != "rate_limited" {
		t.Fatalf("kode galat = %q, mau rate_limited", got)
	}
}

func TestOTP_ResendRateLimit(t *testing.T) {
	srv, _ := newTestServer(t)
	base := srv.URL
	phone := randPhone()

	for i := 0; i < 3; i++ {
		resp := otpRequestRaw(t, base, phone, "device")
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			dumpAndFail(t, resp, fmt.Sprintf("otp/request ke-%d", i+1))
		}
	}

	resp := otpRequestRaw(t, base, phone, "device")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, resp, "otp/request ke-4 harus kena rate limit")
	}
	if got := errorCode(t, resp); got != "rate_limited" {
		t.Fatalf("kode galat = %q, mau rate_limited", got)
	}
}

func otpRequest(t *testing.T, base, phone, purpose string) {
	t.Helper()
	resp := otpRequestRaw(t, base, phone, purpose)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "otp/request")
	}
}

func otpRequestRaw(t *testing.T, base, phone, purpose string) *http.Response {
	t.Helper()
	return doRequest(t, http.MethodPost, base+"/api/v1/auth/otp/request", "", "", map[string]string{"phone": phone, "purpose": purpose})
}

func otpVerifyRaw(t *testing.T, base, phone, code string) *http.Response {
	t.Helper()
	return doRequest(t, http.MethodPost, base+"/api/v1/auth/otp/verify", "", "", map[string]string{"phone": phone, "code": code})
}

// --- PIN ---

func TestPin_SetVerify_ThenLockout(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()
	user := otpLogin(t, base, notifier, phone)

	setResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/pin/set", user.token, map[string]string{"pin": "135790"})
	defer setResp.Body.Close()
	if setResp.StatusCode != http.StatusOK {
		dumpAndFail(t, setResp, "pin/set")
	}

	okResp := doRequest(t, http.MethodPost, base+"/api/v1/auth/pin/verify", "", "", map[string]string{"phone": phone, "pin": "135790"})
	defer okResp.Body.Close()
	if okResp.StatusCode != http.StatusOK {
		dumpAndFail(t, okResp, "pin/verify benar")
	}
	var out struct {
		SessionToken string `json:"session_token"`
	}
	_ = json.NewDecoder(okResp.Body).Decode(&out)
	if out.SessionToken == "" {
		t.Fatal("pin/verify benar harus mengembalikan session_token baru")
	}

	for i := 0; i < 5; i++ {
		resp := doRequest(t, http.MethodPost, base+"/api/v1/auth/pin/verify", "", "", map[string]string{"phone": phone, "pin": "000000"})
		resp.Body.Close()
	}

	lockedResp := doRequest(t, http.MethodPost, base+"/api/v1/auth/pin/verify", "", "", map[string]string{"phone": phone, "pin": "135790"})
	defer lockedResp.Body.Close()
	if lockedResp.StatusCode != http.StatusTooManyRequests {
		dumpAndFail(t, lockedResp, "pin/verify sesudah 5x salah (PIN BENAR pun harus ditolak)")
	}
	if got := errorCode(t, lockedResp); got != "rate_limited" {
		t.Fatalf("kode galat = %q, mau rate_limited", got)
	}
}

// --- Sesi (§7.2.2) ---

func TestSessions_ListRevokeAndRevokeOthers(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	phone := randPhone()

	first := otpLogin(t, base, notifier, phone)
	second := otpLogin(t, base, notifier, phone) // "device baru" — nomor sama, sesi kedua

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/auth/sessions", first.token, nil)
	defer listResp.Body.Close()
	var sessions []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("daftar sesi = %d, mau 2 (dua kali login)", len(sessions))
	}

	// Cabut satu ID spesifik lewat sesi pertama.
	revokeResp := authedRequest(t, http.MethodDelete, base+"/api/v1/auth/sessions/"+sessions[0].ID, first.token, nil)
	defer revokeResp.Body.Close()
	if revokeResp.StatusCode != http.StatusOK {
		dumpAndFail(t, revokeResp, "revoke session")
	}

	third := otpLogin(t, base, notifier, phone)
	// "keluarkan semua kecuali ini" dari sesi ketiga.
	revokeOthersResp := authedRequest(t, http.MethodPost, base+"/api/v1/auth/sessions/revoke-others", third.token, nil)
	defer revokeOthersResp.Body.Close()
	if revokeOthersResp.StatusCode != http.StatusOK {
		dumpAndFail(t, revokeOthersResp, "revoke-others")
	}

	finalList := authedRequest(t, http.MethodGet, base+"/api/v1/auth/sessions", third.token, nil)
	defer finalList.Body.Close()
	var final []struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(finalList.Body).Decode(&final)
	if len(final) != 1 {
		t.Fatalf("sesudah revoke-others, daftar sesi = %d, mau 1 (cuma sesi ketiga)", len(final))
	}

	// second.token (yang tidak pernah dicabut eksplisit maupun jadi "ini")
	// sekarang harus mati juga — dicabut oleh revoke-others.
	usingSecond := authedRequest(t, http.MethodGet, base+"/api/v1/auth/sessions", second.token, nil)
	defer usingSecond.Body.Close()
	if usingSecond.StatusCode != http.StatusUnauthorized {
		dumpAndFail(t, usingSecond, "token sesi kedua seharusnya sudah tercabut")
	}
}

// --- RequirePerm (PLAN.md §7.4, §14 F4 "selesai kalau") ---

// addMembership — role selain admin/member belum bisa ditempel lewat HTTP
// (endpoint undang+atur-peran itu Bagian 3 F4). Test ini menempelnya
// langsung lewat store, sama gen.CreateMembership yang dipakai
// internal/http/clubs.go sendiri.
func addMembership(t *testing.T, clubID, userID string, role gen.ClubRole) {
	t.Helper()
	s := store.New(testdb.Pool(t))
	cID := mustUUID(t, clubID)
	uID := mustUUID(t, userID)
	err := s.WithClub(context.Background(), cID, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreateMembership(ctx, gen.CreateMembershipParams{ClubID: cID, UserID: uID, Role: role})
		return err
	})
	if err != nil {
		t.Fatalf("addMembership: %v", err)
	}
}

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("mustUUID(%q): %v", s, err)
	}
	return id
}

// setSiapaBolehCatat — PATCH /clubs/{id}/settings belum ada (di luar
// lingkup Bagian 1), jadi saklarnya diubah langsung di DB buat menguji
// perm.Resolve tersambung sungguhan ke RequirePerm. clubs TIDAK ber-RLS
// (lihat komentar GetClub di clubs.sql), jadi UPDATE biasa lewat pool aman.
func setSiapaBolehCatat(t *testing.T, clubID, value string) {
	t.Helper()
	pool := testdb.Pool(t)
	_, err := pool.Exec(context.Background(),
		`UPDATE clubs SET settings = jsonb_set(settings, '{siapa_boleh_catat}', to_jsonb($1::text)) WHERE id = $2`,
		value, mustUUID(t, clubID))
	if err != nil {
		t.Fatalf("setSiapaBolehCatat: %v", err)
	}
}

func TestRequirePerm_PencatatBolehCatatMain(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	setSiapaBolehCatat(t, club, "hanya_pengurus") // supaya kasus ini murni izin dari peran, bukan saklar

	pencatat := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, pencatat.userID, gen.ClubRolePencatat)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", pencatat.token, createGameBody(pencatat.userID))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "pencatat catat main")
	}
}

func TestRequirePerm_MemberDitolakDiKlubHanyaPengurus(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	setSiapaBolehCatat(t, club, "hanya_pengurus")

	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, createGameBody(member.userID))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, resp, "member biasa catat main di klub hanya_pengurus harus ditolak")
	}
	if got := errorCode(t, resp); got != "insufficient_permission" {
		t.Fatalf("kode galat = %q, mau insufficient_permission", got)
	}
}

func TestRequirePerm_MemberBolehCatatDiKlubSemuaAnggota(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	// Bawaan klub baru MEMANG "semua_anggota" (clubs.go defaultSettingsJSON)
	// — sengaja TIDAK diubah di test ini, buktikan bawaannya sendiri benar.
	club := createClub(t, base, admin.token, randSlug())

	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", member.token, createGameBody(member.userID))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "member biasa catat main di klub semua_anggota (bawaan) harus boleh")
	}
}
