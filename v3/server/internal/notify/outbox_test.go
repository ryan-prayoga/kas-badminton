// Test Outbox — SEBATAS seam antara cmd/api dan cmd/waworker (tulis ke
// wa_outbox, baca wa_worker_heartbeat). Pengiriman WA sungguhan
// (cmd/waworker) tidak diuji di sini — lihat catatan jujur di
// cmd/waworker/main.go soal kenapa itu tidak bisa diverifikasi di sesi ini.
package notify_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/notify"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/testdb"
)

func pgtypeText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

// randPhone — DB test tidak di-truncate antar run `go test` (proses baru
// tiap kali, tapi tabelnya persisten), jadi nomor tetap akan menumpuk baris
// duplikat lintas run. Pola sama internal/http/f2_test.go.
func randPhone() string {
	return fmt.Sprintf("+62%013d", time.Now().UnixNano()%10_000_000_000_000)
}

func TestOutbox_Send_Enqueues(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ob := notify.NewOutbox(s)

	phone := randPhone()
	if err := ob.Send(context.Background(), notify.Message{Phone: phone, Body: "halo"}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM wa_outbox WHERE phone = $1 AND body = 'halo' AND status = 'queued'", phone).Scan(&count); err != nil {
		t.Fatalf("query wa_outbox: %v", err)
	}
	if count != 1 {
		t.Fatalf("baris wa_outbox buat pesan ini = %d, mau 1", count)
	}
}

func TestOutbox_Health_ConnectedAndFresh(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ob := notify.NewOutbox(s)

	// Simulasi cmd/waworker menulis heartbeat "terhubung".
	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		return q.UpsertWaHeartbeat(ctx, gen.UpsertWaHeartbeatParams{
			Connected: true,
			Detail:    pgtypeText("connected=true logged_in=true"),
		})
	})
	if err != nil {
		t.Fatalf("seed heartbeat: %v", err)
	}

	ok, detail := ob.Health(context.Background())
	if !ok {
		t.Fatalf("Health() = false, mau true (heartbeat baru & connected). detail=%q", detail)
	}
}

func TestOutbox_Health_StaleHeartbeat_ReportsDown(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ob := notify.NewOutbox(s)

	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		return q.UpsertWaHeartbeat(ctx, gen.UpsertWaHeartbeatParams{Connected: true, Detail: pgtypeText("sempat konek")})
	})
	if err != nil {
		t.Fatalf("seed heartbeat: %v", err)
	}
	// Paksa updated_at jadi basi — waworker yang mati mendadak tidak sempat
	// menulis connected=false, jadi kebasiannya sendiri yang harus ketahuan.
	if _, err := pool.Exec(context.Background(), "UPDATE wa_worker_heartbeat SET updated_at = now() - interval '10 minutes' WHERE id = true"); err != nil {
		t.Fatalf("paksa basi: %v", err)
	}

	ok, detail := ob.Health(context.Background())
	if ok {
		t.Fatalf("Health() = true, mau false (heartbeat basi 10 menit). detail=%q", detail)
	}
}

func TestOutbox_Health_ConnectedFalse_ReportsDown(t *testing.T) {
	pool := testdb.Pool(t)
	s := store.New(pool)
	ob := notify.NewOutbox(s)

	err := s.WithinTx(context.Background(), func(ctx context.Context, q *gen.Queries) error {
		return q.UpsertWaHeartbeat(ctx, gen.UpsertWaHeartbeatParams{Connected: false, Detail: pgtypeText("logged_in=false")})
	})
	if err != nil {
		t.Fatalf("seed heartbeat: %v", err)
	}

	ok, _ := ob.Health(context.Background())
	if ok {
		t.Fatal("Health() = true, mau false (connected=false)")
	}
}
