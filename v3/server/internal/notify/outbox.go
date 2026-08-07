package notify

import (
	"context"
	"fmt"
	"time"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Outbox adalah Notifier produksi — TIDAK PERNAH memegang koneksi whatsmeow
// sendiri (PLAN.md §12 "Bridge WA satu proses": dua instance akan
// bentrok). Send cuma menitip baris ke wa_outbox; cmd/waworker (proses
// TERPISAH, satu-satunya pemegang koneksi WA) yang mempolingnya dan
// benar-benar mengirim.
type Outbox struct {
	s *store.Store
}

func NewOutbox(s *store.Store) *Outbox {
	return &Outbox{s: s}
}

func (o *Outbox) Send(ctx context.Context, msg Message) error {
	return o.s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		_, err := q.EnqueueWaMessage(ctx, gen.EnqueueWaMessageParams{Phone: msg.Phone, Body: msg.Body})
		return err
	})
}

// heartbeatStale — kalau waworker tidak sempat update baris ini lebih lama
// dari ini, anggap mati walau connected=true tercatat terakhir kali
// (proses bisa crash tanpa sempat menulis connected=false).
const heartbeatStale = 2 * time.Minute

// Health membaca heartbeat TERAKHIR yang ditulis cmd/waworker — bukan
// mengecek koneksi WA secara langsung (Outbox di proses cmd/api ini tidak
// bisa, sesuai desain §12).
func (o *Outbox) Health(ctx context.Context) (bool, string) {
	var hb gen.WaWorkerHeartbeat
	err := o.s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		var err error
		hb, err = q.GetWaHeartbeat(ctx)
		return err
	})
	if err != nil {
		return false, fmt.Sprintf("gagal baca heartbeat waworker: %v", err)
	}

	age := time.Since(hb.UpdatedAt.Time)
	if age > heartbeatStale {
		return false, fmt.Sprintf("waworker tidak melapor sejak %s lalu (terakhir: %s) — kemungkinan mati", age.Round(time.Second), hb.Detail.String)
	}
	if !hb.Connected {
		return false, "waworker jalan tapi TIDAK terhubung ke WA: " + hb.Detail.String
	}
	return true, hb.Detail.String
}

var (
	_ Notifier      = (*Outbox)(nil)
	_ HealthChecker = (*Outbox)(nil)
)
