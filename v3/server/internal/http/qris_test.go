// Test F6/4 (PLAN.md §14 F6, §9.6): QRIS statis tersimpan per klub +
// QR dinamis sekali pakai + laporan ditolak. Pola sama f2/payments_test.go
// — Postgres sungguhan. Payload di bawah dirakit dari logika production
// (internal/qris) lewat program sekali-pakai, bukan ditebak tangan — CRC
// asli EMVCo tidak bisa dipastikan benar tanpa alat eksternal.
package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

const testStaticQris = "00020101021153033605802ID5919KLUB BADMINTON TEST630443E9"

func putQris(t *testing.T, base, token, clubID, payload string, ifMatch string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, base+"/api/v1/clubs/"+clubID+"/qris",
		bytes.NewReader(mustJSON(map[string]string{"payload": payload})))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("If-Match", ifMatch)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT qris: %v", err)
	}
	return resp
}

func TestQris_GetPut_ValidationAndVersionConflict(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// Klub baru — belum ada QRIS.
	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/qris", member.token, nil)
	defer getResp.Body.Close()
	var got struct {
		MerchantQris *string `json:"merchant_qris"`
		Version      int64   `json:"version"`
	}
	_ = json.NewDecoder(getResp.Body).Decode(&got)
	if got.MerchantQris != nil || got.Version != 1 {
		t.Fatalf("qris klub baru = %+v, mau merchant_qris nil, version 1", got)
	}

	// Member biasa (bukan ManageMoney) ditolak PUT.
	deniedResp := putQris(t, base, member.token, club, testStaticQris, "1")
	defer deniedResp.Body.Close()
	if deniedResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, deniedResp, "member biasa PUT qris harus ditolak")
	}

	// Payload rusak (bukan QRIS sama sekali) ditolak validasi.
	garbageResp := putQris(t, base, admin.token, club, "bukan-qris", "1")
	defer garbageResp.Body.Close()
	if garbageResp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, garbageResp, "payload bukan QRIS harus 400")
	}

	// If-Match basi.
	staleResp := putQris(t, base, admin.token, club, testStaticQris, "99")
	defer staleResp.Body.Close()
	if staleResp.StatusCode != http.StatusConflict {
		dumpAndFail(t, staleResp, "If-Match basi harus 409")
	}

	// Sukses.
	okResp := putQris(t, base, admin.token, club, testStaticQris, "1")
	defer okResp.Body.Close()
	if okResp.StatusCode != http.StatusOK {
		dumpAndFail(t, okResp, "PUT qris valid")
	}
	var saved struct {
		MerchantQris *string `json:"merchant_qris"`
		Version      int64   `json:"version"`
	}
	_ = json.NewDecoder(okResp.Body).Decode(&saved)
	if saved.MerchantQris == nil || *saved.MerchantQris != testStaticQris || saved.Version != 2 {
		t.Fatalf("hasil PUT qris = %+v, mau payload tersimpan & version 2", saved)
	}

	// GET ulang — persisten.
	getAfterResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/qris", member.token, nil)
	defer getAfterResp.Body.Close()
	var gotAfter struct {
		MerchantQris *string `json:"merchant_qris"`
	}
	_ = json.NewDecoder(getAfterResp.Body).Decode(&gotAfter)
	if gotAfter.MerchantQris == nil || *gotAfter.MerchantQris != testStaticQris {
		t.Fatalf("GET qris setelah PUT = %+v, mau payload tersimpan", gotAfter)
	}
}

func TestQris_Dynamic_RequiresConfiguredQrisAndInjectsAmount(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	// Belum ada QRIS klub → ditolak.
	beforeResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/qris/dynamic", member.token,
		map[string]any{"amount": 15000})
	defer beforeResp.Body.Close()
	if beforeResp.StatusCode != http.StatusBadRequest {
		dumpAndFail(t, beforeResp, "buat QR dinamis tanpa QRIS klub harus 400")
	}

	putResp := putQris(t, base, admin.token, club, testStaticQris, "1")
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		dumpAndFail(t, putResp, "PUT qris")
	}

	// Anggota mana pun (bukan cuma ManageMoney) boleh buat QR dinamis
	// buat bayar tagihannya sendiri.
	dynResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/qris/dynamic", member.token,
		map[string]any{"amount": 15000})
	defer dynResp.Body.Close()
	if dynResp.StatusCode != http.StatusCreated {
		dumpAndFail(t, dynResp, "buat QR dinamis")
	}
	var dyn struct {
		ID        string `json:"id"`
		Payload   string `json:"payload"`
		ExpiresAt string `json:"expires_at"`
	}
	_ = json.NewDecoder(dynResp.Body).Decode(&dyn)
	if dyn.ID == "" || dyn.ExpiresAt == "" {
		t.Fatalf("respons QR dinamis kurang lengkap: %+v", dyn)
	}
	if !strings.Contains(dyn.Payload, "540515000") { // tag 54, panjang 5, nilai "15000"
		t.Fatalf("payload dinamis tidak mengandung tag nominal 15000: %s", dyn.Payload)
	}
	if !strings.Contains(dyn.Payload, "010212") { // tag 01, panjang 2, nilai "12" (dinamis)
		t.Fatalf("payload dinamis tidak menandai dirinya dinamis (tag 01=12): %s", dyn.Payload)
	}
	if dyn.Payload == testStaticQris {
		t.Fatal("payload dinamis sama persis dgn statis — amount tidak tersuntik")
	}

	// Lapor ditolak — sukses sekali, dua kali ditolak (404).
	firstReportResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/qris/dynamic/"+dyn.ID+"/report-rejected", member.token, nil)
	defer firstReportResp.Body.Close()
	if firstReportResp.StatusCode != http.StatusOK {
		dumpAndFail(t, firstReportResp, "lapor QR dinamis ditolak")
	}
	secondReportResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/qris/dynamic/"+dyn.ID+"/report-rejected", member.token, nil)
	defer secondReportResp.Body.Close()
	if secondReportResp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, secondReportResp, "lapor QR dinamis ditolak DUA kali harus 404")
	}
}
