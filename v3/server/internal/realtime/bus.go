package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// Bus adalah fan-out in-process dari satu koneksi LISTEN Postgres ke
// banyak subscriber SSE (satu per klien konek, internal/http/events.go).
// Kenapa satu koneksi khusus, bukan lewat pgxpool: LISTEN menahan koneksi
// itu selamanya (block di WaitForNotification) — kalau lewat pool, satu
// koneksi pool akan "hilang" dari rotasi normal.
type Bus struct {
	dsn    string
	logger *slog.Logger

	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

type subscriber struct {
	ch    chan Event
	clubs map[uuid.UUID]struct{}
}

// NewBus membuka goroutine LISTEN yang jalan sampai ctx dibatalkan, dengan
// reconnect otomatis kalau koneksinya putus (jaringan, restart DB, dst).
func NewBus(ctx context.Context, dsn string, logger *slog.Logger) *Bus {
	b := &Bus{
		dsn:    dsn,
		logger: logger,
		subs:   map[*subscriber]struct{}{},
	}
	go b.listenLoop(ctx)
	return b
}

// Publish memicu NOTIFY di dalam transaksi yang sedang berjalan (dipanggil
// dari fn yang sama yang dilempar ke store.WithClub/WithinTx). Postgres
// menahan pengiriman NOTIFY sampai transaksi itu COMMIT — jadi subscriber
// tidak pernah melihat event untuk data yang ternyata di-rollback.
func Publish(ctx context.Context, q *gen.Queries, evt Event) error {
	payload, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	return q.PgNotify(ctx, gen.PgNotifyParams{Channel: Channel, Payload: string(payload)})
}

// Subscribe dipanggil handler SSE sekali per koneksi klien. clubIDs adalah
// klub yang diikuti user itu, dihitung SEKALI saat konek dari memberships
// — event untuk klub lain tidak pernah masuk channel ini (§6.2, bagian
// dari suite kebocoran antar-klub, bukan cuma UX). Memanggil unsubscribe
// wajib dilakukan pemanggil (biasanya lewat defer) begitu koneksi SSE
// tertutup.
func (b *Bus) Subscribe(clubIDs []uuid.UUID) (ch <-chan Event, unsubscribe func()) {
	set := make(map[uuid.UUID]struct{}, len(clubIDs))
	for _, id := range clubIDs {
		set[id] = struct{}{}
	}
	sub := &subscriber{ch: make(chan Event, 16), clubs: set}

	b.mu.Lock()
	b.subs[sub] = struct{}{}
	b.mu.Unlock()

	return sub.ch, func() {
		b.mu.Lock()
		delete(b.subs, sub)
		b.mu.Unlock()
		close(sub.ch)
	}
}

func (b *Bus) listenLoop(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if err := b.listenOnce(ctx); err != nil && ctx.Err() == nil {
			b.logger.Warn("realtime: koneksi listen terputus, coba lagi", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}
}

func (b *Bus) listenOnce(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, b.dsn)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, "LISTEN "+Channel); err != nil {
		return err
	}
	b.logger.Info("realtime: listen aktif", "channel", Channel)

	for {
		notif, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var evt Event
		if err := json.Unmarshal([]byte(notif.Payload), &evt); err != nil {
			b.logger.Warn("realtime: payload notify tidak valid, dilewati", "err", err)
			continue
		}
		b.fanOut(evt)
	}
}

func (b *Bus) fanOut(evt Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for sub := range b.subs {
		if _, ok := sub.clubs[evt.ClubID]; !ok {
			continue
		}
		select {
		case sub.ch <- evt:
		default:
			// Subscriber lambat — dibuang, bukan memblokir publisher.
			// SSE bukan jalur yang menjamin pengiriman (§6 "Diketahui
			// belum lengkap" di plan F2); klien refetch saat reconnect.
			b.logger.Warn("realtime: subscriber lambat, event dibuang")
		}
	}
}
