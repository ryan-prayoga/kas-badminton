// Test F4 bagian 5 (PLAN.md §14 F4, §6.5, API.md §7): panel superadmin.
// Pola sama f2/f4/f6_test.go — Postgres sungguhan.
package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

// makeSuperadmin — belum ada endpoint buat menaikkan superadmin lewat HTTP
// (platform_admins diisi manual oleh operator, di luar app — PLAN.md tidak
// menyebut alur onboarding-nya). Test menempelnya langsung, sama pola
// addMembership.
func makeSuperadmin(t *testing.T, userID string) {
	t.Helper()
	s := store.New(testdb.Pool(t))
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		return q.GrantSuperadmin(ctx, mustUUID(t, userID))
	})
	if err != nil {
		t.Fatalf("makeSuperadmin: %v", err)
	}
}

func TestAdmin_NonSuperadminGets404(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	user := otpLogin(t, base, notifier, randPhone())

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/admin/clubs", user.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		dumpAndFail(t, resp, "GET /admin/clubs oleh bukan-superadmin harus 404")
	}
}

func TestAdmin_ListClubsWithMemberCount(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	m1 := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, m1.userID, gen.ClubRoleMember)

	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/admin/clubs", sudo.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET /admin/clubs")
	}
	var clubs []struct {
		ID          string `json:"id"`
		MemberCount int64  `json:"member_count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&clubs); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var found bool
	for _, c := range clubs {
		if c.ID == club {
			found = true
			if c.MemberCount != 2 {
				t.Errorf("member_count klub ini = %d, mau 2 (admin+m1)", c.MemberCount)
			}
		}
	}
	if !found {
		t.Fatal("klub yang baru dibuat tidak muncul di GET /admin/clubs")
	}
}

func TestAdmin_SuspendClub(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/admin/clubs/"+club+"/suspend", sudo.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "suspend club")
	}
	var got struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.Status != "suspended" {
		t.Fatalf("status sesudah suspend = %q, mau suspended", got.Status)
	}
}

func TestAdmin_UpdateQuotas_Merges(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL

	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	resp := authedRequest(t, http.MethodPost, base+"/api/v1/admin/clubs/"+club+"/quotas", sudo.token,
		map[string]int{"wa_pesan_per_hari": 500})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "update quotas")
	}

	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/", admin.token, nil)
	defer getResp.Body.Close()
	var got struct {
		Settings map[string]any `json:"settings"`
	}
	_ = json.NewDecoder(getResp.Body).Decode(&got)
	// Cek lewat clubDTO tidak expose quotas — cukup pastikan endpoint sukses
	// dan tidak merusak field lain (settings tetap ada/utuh).
	if got.Settings == nil {
		t.Fatal("settings hilang sesudah update quotas — quotas & settings semestinya independen")
	}
}

func TestAdmin_WaHealth_ReportsFakeHonestly(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)

	resp := authedRequest(t, http.MethodGet, base+"/api/v1/admin/wa/health", sudo.token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET /admin/wa/health")
	}
	var got struct {
		OK     bool   `json:"ok"`
		Detail string `json:"detail"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.Detail == "" {
		t.Fatal("detail kosong — harus jujur soal notifier palsu, bukan diam")
	}
}

// TestAdmin_QueueDepth_GrowsWhenNotificationsEnqueued — F8 mengisi
// `notifications` sungguhan sekarang (dulu selalu 0 sampai F8 jalan).
// DB test dipakai bersama seluruh test lain di paket ini (tidak
// diisolasi per test), jadi ini mengukur SELISIH sebelum/sesudah satu
// aksi yang pasti memicu notifikasi (catat main 2 pemain → 2 baris
// game_recorded), bukan angka absolut.
func TestAdmin_QueueDepth_GrowsWhenNotificationsEnqueued(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	sudo := otpLogin(t, base, notifier, randPhone())
	makeSuperadmin(t, sudo.userID)
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	lawan := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, lawan.userID, gen.ClubRoleMember)

	before := queueDepthTotal(t, base, sudo.token)
	createGameWithBody(t, base, admin.token, club, twoPlayerGameBody(admin.userID, lawan.userID, nil))
	after := queueDepthTotal(t, base, sudo.token)

	if after < before+2 {
		t.Fatalf("total antrean = %d (sebelum %d), mau naik minimal 2 (game_recorded ke 2 pemain)", after, before)
	}
}

func queueDepthTotal(t *testing.T, base, token string) int64 {
	t.Helper()
	resp := authedRequest(t, http.MethodGet, base+"/api/v1/admin/notifications/queue-depth", token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "GET /admin/notifications/queue-depth")
	}
	var got struct {
		Total int64 `json:"total"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	return got.Total
}
