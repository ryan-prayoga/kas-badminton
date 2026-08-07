// Test end-to-end F2 (PLAN.md §14 "selesai kalau"): suite kebocoran
// antar-klub, idempotensi, konflik versi, dan realtime SSE tanpa refetch
// penuh. Semua butuh Postgres sungguhan — testdb.DSN men-skip kalau
// TEST_DATABASE_URL tidak diset (lihat internal/testdb).
package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	httpapi "github.com/ryan-prayoga/kas-badminton/v3/server/internal/http"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/realtime"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

var idCounter int64

// processSalt + counter, bukan cuma counter: test DB tidak di-truncate
// antar run (setiap `go test` adalah proses baru, counter reset ke 0),
// jadi counter saja bisa tabrakan sama baris sisa run sebelumnya (slug
// "test-1" dst). processSalt bikin tiap proses test punya rentang sendiri.
var processSalt = time.Now().UnixNano()

func uniqueSuffix() int64 { return atomic.AddInt64(&idCounter, 1) }

func randPhone() string {
	return fmt.Sprintf("+62%013d", (processSalt%1_000_000_000)*1000+uniqueSuffix()%1000)
}
func randSlug() string { return fmt.Sprintf("test-%d-%d", processSalt, uniqueSuffix()) }

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool, dsn := testdb.PoolAndDSN(t)
	s := store.New(pool)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	bus := realtime.NewBus(ctx, dsn, logging.New("dev", "warn"))

	r := chi.NewRouter()
	httpapi.Mount(r, s, bus, true) // isDev=true — dev/login perlu nyala buat test

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

type loggedInUser struct {
	token, userID string
}

func devLogin(t *testing.T, base, phone string) loggedInUser {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"phone": phone})
	resp, err := http.Post(base+"/api/v1/dev/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("dev/login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		dumpAndFail(t, resp, "dev/login")
	}
	var out struct {
		SessionToken string `json:"session_token"`
		User         struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode dev/login: %v", err)
	}
	return loggedInUser{token: out.SessionToken, userID: out.User.ID}
}

func doRequest(t *testing.T, method, url, token, idemKey string, body any) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

// authedRequest — kunci idempotensi baru tiap panggilan (dipakai kasus
// yang tidak sedang menguji idempotensi itu sendiri). Harus UUID v4 —
// RequireIdempotency menolak bentuk lain (API.md §0).
func authedRequest(t *testing.T, method, url, token string, body any) *http.Response {
	return doRequest(t, method, url, token, uuid.NewString(), body)
}

func dumpAndFail(t *testing.T, resp *http.Response, ctx string) {
	t.Helper()
	b, _ := io.ReadAll(resp.Body)
	t.Fatalf("%s: status %d, body: %s", ctx, resp.StatusCode, string(b))
}

func createClub(t *testing.T, base, token, slug string) string {
	t.Helper()
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs", token, map[string]string{"slug": slug, "name": slug})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create club")
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.ID
}

type gameResp struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

func createGameBody(userID string) map[string]any {
	return map[string]any{
		"played_on": time.Now().Format("2006-01-02"),
		"format":    "single",
		"players":   []map[string]any{{"user_id": userID, "side": "a", "slot": 1}},
	}
}

func createGame(t *testing.T, base, token, clubID, userID string) gameResp {
	t.Helper()
	resp := authedRequest(t, http.MethodPost, base+"/api/v1/clubs/"+clubID+"/games", token, createGameBody(userID))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp, "create game")
	}
	var out gameResp
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out
}

func errorCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	b, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(b, &out)
	if out.Error.Code == "" {
		t.Fatalf("respons bukan error envelope: %s", string(b))
	}
	return out.Error.Code
}

// --- suite kebocoran antar-klub (PLAN.md §6.2, §14 F2 "selesai kalau") ---

func TestLeak_CrossClubEndpoints(t *testing.T) {
	srv := newTestServer(t)
	base := srv.URL

	userA := devLogin(t, base, randPhone())
	userB := devLogin(t, base, randPhone())
	// userA sengaja TIDAK bikin klub sendiri — test ini membuktikan dia
	// ditolak akses klub B, bukan menguji klub A miliknya sendiri.
	clubB := createClub(t, base, userB.token, randSlug())
	gameB := createGame(t, base, userB.token, clubB, userB.userID)

	cases := []struct {
		name         string
		method, path string
		body         any
	}{
		{"get club", http.MethodGet, "/api/v1/clubs/" + clubB, nil},
		{"list games", http.MethodGet, "/api/v1/clubs/" + clubB + "/games", nil},
		{"get game", http.MethodGet, "/api/v1/clubs/" + clubB + "/games/" + gameB.ID, nil},
		{"create game", http.MethodPost, "/api/v1/clubs/" + clubB + "/games", createGameBody(userB.userID)},
		{"update game", http.MethodPatch, "/api/v1/clubs/" + clubB + "/games/" + gameB.ID, map[string]string{"notes": "x"}},
		{"delete game", http.MethodDelete, "/api/v1/clubs/" + clubB + "/games/" + gameB.ID, nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := authedRequest(t, tc.method, base+tc.path, userA.token, tc.body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("user klub A akses %s %s: status = %d, mau 404", tc.method, tc.path, resp.StatusCode)
			}
			if code := errorCode(t, resp); code != "not_found" {
				t.Fatalf("kode galat = %q, mau not_found", code)
			}
		})
	}
}

// --- idempotensi (invarian §3.3) ---

func TestIdempotency_SameKeySameBody_NoDuplicateRow(t *testing.T) {
	srv := newTestServer(t)
	base := srv.URL

	user := devLogin(t, base, randPhone())
	club := createClub(t, base, user.token, randSlug())
	key := uuid.NewString()
	body := createGameBody(user.userID)

	resp1 := doRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", user.token, key, body)
	defer resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp1, "first create")
	}
	var g1 gameResp
	_ = json.NewDecoder(resp1.Body).Decode(&g1)

	resp2 := doRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", user.token, key, body)
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusCreated {
		dumpAndFail(t, resp2, "replay create")
	}
	var g2 gameResp
	_ = json.NewDecoder(resp2.Body).Decode(&g2)

	if g1.ID != g2.ID {
		t.Fatalf("replay idempotensi menghasilkan entitas berbeda: %s vs %s", g1.ID, g2.ID)
	}

	listResp := authedRequest(t, http.MethodGet, base+"/api/v1/clubs/"+club+"/games", user.token, nil)
	defer listResp.Body.Close()
	var list struct {
		Items []gameResp `json:"items"`
	}
	_ = json.NewDecoder(listResp.Body).Decode(&list)
	if len(list.Items) != 1 {
		t.Fatalf("kunci sama + body sama harus menghasilkan SATU baris games, dapat %d", len(list.Items))
	}
}

func TestIdempotency_SameKeyDifferentBody_Conflict(t *testing.T) {
	srv := newTestServer(t)
	base := srv.URL

	user := devLogin(t, base, randPhone())
	club := createClub(t, base, user.token, randSlug())
	key := uuid.NewString()

	resp1 := doRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", user.token, key, createGameBody(user.userID))
	resp1.Body.Close()
	if resp1.StatusCode != http.StatusCreated {
		t.Fatalf("permintaan pertama harus 201, dapat %d", resp1.StatusCode)
	}

	bodyBeda := createGameBody(user.userID)
	bodyBeda["notes"] = "beda dari yang pertama"
	resp2 := doRequest(t, http.MethodPost, base+"/api/v1/clubs/"+club+"/games", user.token, key, bodyBeda)
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		dumpAndFail(t, resp2, "harus 409 idempotency_key_reused")
	}
	if code := errorCode(t, resp2); code != "idempotency_key_reused" {
		t.Fatalf("kode galat = %q, mau idempotency_key_reused", code)
	}
}

// --- konflik versi (invarian §3.4) ---

func TestVersionConflict_StaleIfMatch(t *testing.T) {
	srv := newTestServer(t)
	base := srv.URL

	user := devLogin(t, base, randPhone())
	club := createClub(t, base, user.token, randSlug())
	game := createGame(t, base, user.token, club, user.userID)
	if game.Version != 1 {
		t.Fatalf("game baru harus version=1, dapat %d", game.Version)
	}

	req, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/games/"+game.ID,
		bytes.NewReader(mustJSON(map[string]string{"notes": "coba ubah dengan versi basi"})))
	req.Header.Set("Authorization", "Bearer "+user.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("If-Match", "999")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		dumpAndFail(t, resp, "if-match basi harus 409")
	}
	if code := errorCode(t, resp); code != "version_conflict" {
		t.Fatalf("kode galat = %q, mau version_conflict", code)
	}

	req2, _ := http.NewRequest(http.MethodPatch, base+"/api/v1/clubs/"+club+"/games/"+game.ID,
		bytes.NewReader(mustJSON(map[string]string{"notes": "versi benar"})))
	req2.Header.Set("Authorization", "Bearer "+user.token)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Idempotency-Key", uuid.NewString())
	req2.Header.Set("If-Match", "1")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("patch benar: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		dumpAndFail(t, resp2, "if-match benar harus 200")
	}
	var updated gameResp
	_ = json.NewDecoder(resp2.Body).Decode(&updated)
	if updated.Version != 2 {
		t.Fatalf("version sesudah edit harus naik jadi 2, dapat %d", updated.Version)
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// --- realtime SSE tanpa refetch penuh, dan tanpa bocor lintas klub ---

func TestRealtime_SSE_NoCrossClubLeak(t *testing.T) {
	srv := newTestServer(t)
	base := srv.URL

	userA := devLogin(t, base, randPhone())
	clubA := createClub(t, base, userA.token, randSlug())
	userB := devLogin(t, base, randPhone())
	clubB := createClub(t, base, userB.token, randSlug())

	gotA := make(chan string, 4)
	gotB := make(chan string, 4)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	go streamSSE(ctx, base, userA.token, clubA, gotA)
	go streamSSE(ctx, base, userB.token, clubB, gotB)

	// Beri waktu handler SSE subscribe ke bus sebelum event dipublish.
	time.Sleep(400 * time.Millisecond)

	createGame(t, base, userA.token, clubA, userA.userID)

	select {
	case line := <-gotA:
		if !strings.Contains(line, "game.created") {
			t.Fatalf("event pertama klub A = %q, mau game.created", line)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("klub A tidak menerima event game.created lewat SSE dalam 5 detik")
	}

	select {
	case line := <-gotB:
		t.Fatalf("klub B seharusnya TIDAK menerima event klub A, tapi dapat: %q", line)
	case <-time.After(1 * time.Second):
		// diharapkan: tidak ada apa-apa.
	}
}

func streamSSE(ctx context.Context, base, token, clubID string, out chan<- string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/events?club_id="+clubID, nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			select {
			case out <- line:
			default:
			}
		}
	}
}
