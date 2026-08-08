// Test F8 (PLAN.md §14, §10): router notifikasi (Push vs WA, jam tenang,
// preferensi), Dispatcher (fallback push→WA), endpoint /me/notifications,
// /me/notification-prefs, /me/push-subscriptions, share teks. Pola sama
// f2/f7_test.go — Postgres sungguhan.
package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/push"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func newStoreForTest(t *testing.T) *store.Store {
	t.Helper()
	return store.New(testdb.Pool(t))
}

// TestNotifyEnqueue_NoPushSubscription_FallsBackToWa — orang belum
// pernah daftar push subscription → langsung WA, bukan antre push yang
// tidak akan pernah terkirim (§10.1 "tak berlangganan → WA").
func TestNotifyEnqueue_NoPushSubscription_FallsBackToWa(t *testing.T) {
	s := newStoreForTest(t)
	userID := mustUUID(t, uuidFor(t, s, "no-sub-"+randPhone()))
	clubID := mustUUID(t, clubUUIDFor(t, s))

	var row gen.Notification
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: userID, ClubID: &clubID, ClubTimezone: "Asia/Jakarta",
			Kind: domain.NotifGameRecorded, Now: time.Now(), Title: "t", Body: "b",
		}); err != nil {
			return err
		}
		rows, err := q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{UserID: userID})
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			t.Fatalf("baris notifikasi = %d, mau 1", len(rows))
		}
		row = rows[0]
		return nil
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if row.Channel != gen.NotifChannelWa {
		t.Fatalf("channel = %q, mau wa (tanpa langganan push)", row.Channel)
	}
	if row.Status != gen.NotifStatusQueued {
		t.Fatalf("status = %q, mau queued", row.Status)
	}
}

// TestNotifyEnqueue_BothChannelsOff_WritesSkippedInapp — dua-duanya
// dimatikan tetap tercatat channel=inapp/status=skipped, TIDAK hilang
// (§10.1 "pusat notifikasi adalah kebenaran").
func TestNotifyEnqueue_BothChannelsOff_WritesSkippedInapp(t *testing.T) {
	s := newStoreForTest(t)
	userID := mustUUID(t, uuidFor(t, s, "both-off-"+randPhone()))
	clubID := mustUUID(t, clubUUIDFor(t, s))

	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		if _, err := q.UpsertNotificationPref(ctx, gen.UpsertNotificationPrefParams{
			UserID: userID, ClubID: &clubID, Kind: string(domain.NotifGameRecorded), PushOn: false, WaOn: false,
		}); err != nil {
			return err
		}
		if err := notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: userID, ClubID: &clubID, ClubTimezone: "Asia/Jakarta",
			Kind: domain.NotifGameRecorded, Now: time.Now(), Title: "t", Body: "b",
		}); err != nil {
			return err
		}
		rows, err := q.ListNotificationsByUser(ctx, gen.ListNotificationsByUserParams{UserID: userID})
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			t.Fatalf("baris = %d, mau 1", len(rows))
		}
		if rows[0].Channel != gen.NotifChannelInapp || rows[0].Status != gen.NotifStatusSkipped {
			t.Fatalf("channel/status = %s/%s, mau inapp/skipped", rows[0].Channel, rows[0].Status)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
}

type fakePushSender struct {
	err   error
	calls int
}

func (f *fakePushSender) Send(_ context.Context, _ push.Subscription, _ []byte) error {
	f.calls++
	return f.err
}

// TestDispatcher_PushFails_FallsBackToWa_ThenSendsViaNotifier — jalur
// penuh: baris push gagal terus → ditandai failed + baris WA baru
// diantre → putaran WA berikutnya benar-benar "terkirim" (lewat Notifier
// yang sama dipakai OTP, di sini captureNotifier).
func TestDispatcher_PushFails_FallsBackToWa_ThenSendsViaNotifier(t *testing.T) {
	s := newStoreForTest(t)
	phone := randPhone()
	userID := mustUUID(t, uuidWithPhone(t, s, phone))
	clubID := mustUUID(t, clubUUIDFor(t, s))

	// Daftar satu langganan push palsu supaya Dispatcher benar-benar
	// mencoba mengirim (bukan langsung fallback di titik "tidak ada
	// langganan").
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		_, err := q.CreatePushSubscription(ctx, gen.CreatePushSubscriptionParams{
			UserID: userID, Endpoint: "https://push.example/" + userID.String(), P256dh: "p", Auth: "a",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create push subscription: %v", err)
	}

	err = s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		return notify.Enqueue(ctx, q, notify.NotifyInput{
			UserID: userID, ClubID: &clubID, ClubTimezone: "Asia/Jakarta",
			Kind: domain.NotifGameRecorded, Now: time.Now(), Title: "t", Body: "b", WaBody: "teks WA",
		})
	})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	capture := newCaptureNotifier()
	pushSender := &fakePushSender{err: errAlwaysFail}
	d := notify.NewDispatcher(s, pushSender, capture, testLogger())

	if err := d.DispatchOnce(context.Background()); err != nil {
		t.Fatalf("dispatch putaran 1: %v", err)
	}
	if pushSender.calls == 0 {
		t.Fatalf("push.Sender tidak pernah dipanggil")
	}

	// DB test dipakai bersama seluruh test lain di paket ini — antrean WA
	// bisa sudah berisi ratusan baris sisa test lain (fallback dari
	// enqueue tanpa langganan push) sebelum baris kita sendiri sempat
	// dipoll (batch Dispatcher terbatas per putaran). Ulangi sampai
	// ketemu ATAU batas wajar tercapai, bukan cuma sekali/dua kali.
	for i := 0; i < 500 && capture.last[phone] == ""; i++ {
		if err := d.DispatchOnce(context.Background()); err != nil {
			t.Fatalf("dispatch putaran WA fallback ke-%d: %v", i, err)
		}
	}

	if capture.last[phone] == "" {
		t.Fatalf("Notifier (WA) tidak pernah dipanggil buat %s setelah push gagal", phone)
	}
}

var errAlwaysFail = fakeSendErr{}

type fakeSendErr struct{}

func (fakeSendErr) Error() string { return "push gagal (simulasi test)" }

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// uuidFor — bikin user aktif baru (nomor acak) + membership klub baru,
// balikin user id sebagai string.
func uuidFor(t *testing.T, s *store.Store, seed string) string {
	t.Helper()
	return uuidWithPhone(t, s, randPhone())
}

func uuidWithPhone(t *testing.T, s *store.Store, phone string) string {
	t.Helper()
	var id string
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		u, err := q.CreateUser(ctx, gen.CreateUserParams{Phone: textOfTest(phone), DisplayName: "Test " + phone})
		if err != nil {
			return err
		}
		id = u.ID.String()
		return nil
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

func clubUUIDFor(t *testing.T, s *store.Store) string {
	t.Helper()
	var id string
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		c, err := q.CreateClub(ctx, gen.CreateClubParams{
			ID: uuid.New(), Slug: "notify-test-" + randPhone(), Name: "Klub Notify Test",
			Timezone: "Asia/Jakarta", Settings: []byte(`{}`), Quotas: []byte(`{}`),
		})
		if err != nil {
			return err
		}
		id = c.ID.String()
		return nil
	})
	if err != nil {
		t.Fatalf("create club: %v", err)
	}
	return id
}

// TestPushSubscriptions_CreateListDelete — CRUD /me/push-subscriptions.
func TestPushSubscriptions_CreateListDelete(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	user := otpLogin(t, base, notifier, randPhone())

	body := map[string]any{
		"endpoint": "https://push.example/abc",
		"keys":     map[string]string{"p256dh": "p", "auth": "a"},
	}
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/me/push-subscriptions", user.token, body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create push subscription")
	}
	var sub struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&sub)
	if sub.ID == "" {
		t.Fatalf("id kosong")
	}

	delResp := authedRequest(t, http.MethodDelete, base+"/api/v1/me/push-subscriptions/"+sub.ID, user.token, nil)
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusNoContent {
		dumpAndFail(t, delResp, "delete push subscription")
	}
}

// TestNotificationPrefs_PatchAndGet — PATCH lalu GET mencerminkan.
func TestNotificationPrefs_PatchAndGet(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	user := otpLogin(t, base, notifier, randPhone())

	resp := authedRequest(t, http.MethodPatch, base+"/api/v1/me/notification-prefs", user.token, map[string]any{
		"kind": "game_recorded", "push_on": false, "wa_on": true,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "patch notification-prefs")
	}

	getResp := authedRequest(t, http.MethodGet, base+"/api/v1/me/notification-prefs", user.token, nil)
	defer getResp.Body.Close()
	var got struct {
		Items []struct {
			Kind   string `json:"kind"`
			PushOn bool   `json:"push_on"`
			WaOn   bool   `json:"wa_on"`
		} `json:"items"`
	}
	_ = json.NewDecoder(getResp.Body).Decode(&got)
	found := false
	for _, item := range got.Items {
		if item.Kind == "game_recorded" {
			found = true
			if item.PushOn != false || item.WaOn != true {
				t.Fatalf("pref tersimpan salah: %+v", item)
			}
		}
	}
	if !found {
		t.Fatalf("preferensi game_recorded tidak muncul di GET: %+v", got.Items)
	}
}

// TestShareBill_SelfAllowed_OthersForbiddenUnlessBendahara.
func TestShareBill_SelfAllowed_OthersForbiddenUnlessBendahara(t *testing.T) {
	srv, notifier := newTestServer(t)
	base := srv.URL
	admin := otpLogin(t, base, notifier, randPhone())
	club := createClub(t, base, admin.token, randSlug())
	member := otpLogin(t, base, notifier, randPhone())
	addMembership(t, club, member.userID, gen.ClubRoleMember)

	selfResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/share/bill/"+member.userID, member.token, nil)
	defer selfResp.Body.Close()
	if selfResp.StatusCode != http.StatusOK {
		dumpAndFail(t, selfResp, "share bill sendiri")
	}
	var out struct {
		Text string `json:"text"`
	}
	_ = json.NewDecoder(selfResp.Body).Decode(&out)
	if out.Text == "" {
		t.Fatalf("teks share kosong")
	}

	forbiddenResp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/share/bill/"+admin.userID, member.token, nil)
	defer forbiddenResp.Body.Close()
	if forbiddenResp.StatusCode != http.StatusForbidden {
		dumpAndFail(t, forbiddenResp, "member share tagihan admin harusnya ditolak")
	}

	adminSharesMember := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/share/bill/"+member.userID, admin.token, nil)
	defer adminSharesMember.Body.Close()
	if adminSharesMember.StatusCode != http.StatusOK {
		dumpAndFail(t, adminSharesMember, "admin (bendahara jatuh-balik) share tagihan member")
	}
}

func textOfTest(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
