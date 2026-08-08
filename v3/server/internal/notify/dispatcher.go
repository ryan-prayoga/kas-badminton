package notify

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/domain"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/push"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

const (
	dispatchBatchSize = 25
	// maxPushFailures — langganan dihapus setelah gagal berturut-turut
	// sebanyak ini (bukan langsung di kegagalan pertama — jaringan HP
	// putus sesaat itu wajar, jangan buru-buru dianggap mati).
	maxPushFailures = 5
	// waQuotaBackoff — kalau kuota WA klub habis, baris ditunda sekian
	// lama sebelum dicoba lagi, bukan dipoll ulang tiap tick sia-sia.
	waQuotaBackoff = time.Hour
)

// Dispatcher mengirim baris `notifications` berstatus queued — push lewat
// push.Sender (Web Push sungguhan), WA lewat Notifier yang SAMA dipakai
// OTP (Outbox → wa_outbox → cmd/waworker, PLAN.md §12 "bridge WA satu
// proses"). Dipanggil sekali per tick dari cmd/api (main.go), bukan
// proses terpisah — beda dari cmd/waworker yang memang wajib satu proses
// karena memegang koneksi whatsmeow; di sini tidak ada state eksternal
// yang perlu dijaga tunggal.
type Dispatcher struct {
	store  *store.Store
	push   push.Sender
	wa     Notifier
	logger *slog.Logger
}

func NewDispatcher(s *store.Store, pushSender push.Sender, wa Notifier, logger *slog.Logger) *Dispatcher {
	return &Dispatcher{store: s, push: pushSender, wa: wa, logger: logger}
}

// Run memblokir sampai ctx dibatalkan — panggil lewat `go d.Run(ctx, ...)`.
func (d *Dispatcher) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := d.DispatchOnce(ctx); err != nil {
				d.logger.Error("notify: satu putaran dispatch gagal", "err", err)
			}
		}
	}
}

// DispatchOnce — satu putaran push lalu satu putaran WA. Diekspor
// terpisah dari Run supaya test bisa memanggilnya langsung tanpa
// menunggu ticker sungguhan.
func (d *Dispatcher) DispatchOnce(ctx context.Context) error {
	if err := d.dispatchPush(ctx); err != nil {
		return err
	}
	return d.dispatchWa(ctx)
}

func (d *Dispatcher) dispatchPush(ctx context.Context) error {
	return d.store.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		rows, err := q.ListDueNotificationsByChannel(ctx, gen.ListDueNotificationsByChannelParams{
			Channel: gen.NotifChannelPush, Limit: dispatchBatchSize,
		})
		if err != nil {
			return err
		}
		for _, n := range rows {
			if err := d.sendOnePush(ctx, q, n); err != nil {
				d.logger.Error("notify: kirim push gagal", "notification_id", n.ID, "err", err)
			}
		}
		return nil
	})
}

func (d *Dispatcher) sendOnePush(ctx context.Context, q *gen.Queries, n gen.Notification) error {
	subs, err := q.ListPushSubscriptionsByUser(ctx, n.UserID)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return d.failAndFallbackToWa(ctx, q, n, "tidak ada langganan push")
	}

	anyOK := false
	var lastErr error
	for _, sub := range subs {
		err := d.push.Send(ctx, push.Subscription{Endpoint: sub.Endpoint, P256dh: sub.P256dh, Auth: sub.Auth}, n.Payload)
		if err == nil {
			anyOK = true
			if e := q.MarkPushSubscriptionOk(ctx, sub.ID); e != nil {
				return e
			}
			continue
		}
		lastErr = err
		if errors.Is(err, push.ErrSubscriptionGone) {
			if e := q.DeletePushSubscriptionByEndpoint(ctx, sub.Endpoint); e != nil {
				return e
			}
			continue
		}
		updated, e := q.IncrementPushSubscriptionFailed(ctx, sub.ID)
		if e != nil {
			return e
		}
		if updated.Failed >= maxPushFailures {
			if e := q.DeletePushSubscriptionByEndpoint(ctx, updated.Endpoint); e != nil {
				return e
			}
		}
	}

	if anyOK {
		_, err := q.MarkNotificationSent(ctx, n.ID)
		return err
	}
	msg := "push gagal ke semua langganan"
	if lastErr != nil {
		msg = lastErr.Error()
	}
	return d.failAndFallbackToWa(ctx, q, n, msg)
}

// failAndFallbackToWa — tandai baris push ini gagal, lalu antrekan WA
// SEBAGAI BARIS BARU (§10.1 "push gagal / tak berlangganan → WA") kalau
// preferensi orangnya masih mengizinkan WA buat jenis ini.
func (d *Dispatcher) failAndFallbackToWa(ctx context.Context, q *gen.Queries, n gen.Notification, reason string) error {
	if _, err := q.MarkNotificationFailed(ctx, gen.MarkNotificationFailedParams{ID: n.ID, Error: textOf(reason)}); err != nil {
		return err
	}
	_, waOn, err := resolvePrefs(ctx, q, n.UserID, n.ClubID, domain.NotifKind(n.Kind))
	if err != nil {
		return err
	}
	if !waOn {
		return nil
	}
	var p notifPayload
	_ = json.Unmarshal(n.Payload, &p)
	_, err = q.CreateNotification(ctx, gen.CreateNotificationParams{
		UserID: n.UserID, ClubID: n.ClubID, Kind: n.Kind, Channel: gen.NotifChannelWa,
		Payload: n.Payload, Status: gen.NotifStatusQueued, SendAfter: nowTs(),
	})
	return err
}

func (d *Dispatcher) dispatchWa(ctx context.Context) error {
	return d.store.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		rows, err := q.ListDueNotificationsByChannel(ctx, gen.ListDueNotificationsByChannelParams{
			Channel: gen.NotifChannelWa, Limit: dispatchBatchSize,
		})
		if err != nil {
			return err
		}
		for _, n := range rows {
			if err := d.sendOneWa(ctx, q, n); err != nil {
				d.logger.Error("notify: kirim WA gagal", "notification_id", n.ID, "err", err)
			}
		}
		return nil
	})
}

func (d *Dispatcher) sendOneWa(ctx context.Context, q *gen.Queries, n gen.Notification) error {
	if n.ClubID != nil {
		club, err := q.GetClub(ctx, *n.ClubID)
		if err != nil {
			return err
		}
		var quotas struct {
			WaPesanPerHari int `json:"wa_pesan_per_hari"`
		}
		quotas.WaPesanPerHari = 50 // bawaan §12.1, dipakai kalau klub belum pernah diset quotas-nya
		if len(club.Quotas) > 0 {
			_ = json.Unmarshal(club.Quotas, &quotas)
		}
		sentToday, err := q.CountWaSentTodayByClub(ctx, n.ClubID)
		if err != nil {
			return err
		}
		if quotas.WaPesanPerHari > 0 && sentToday >= int64(quotas.WaPesanPerHari) {
			_, err := q.RescheduleNotification(ctx, gen.RescheduleNotificationParams{
				ID: n.ID, SendAfter: pgtypeFuture(waQuotaBackoff),
			})
			return err
		}
	}

	user, err := q.GetUser(ctx, n.UserID)
	if err != nil {
		return err
	}
	if !user.Phone.Valid || user.Phone.String == "" {
		_, err := q.MarkNotificationFailed(ctx, gen.MarkNotificationFailedParams{
			ID: n.ID, Error: textOf("orang ini tidak punya nomor WA terverifikasi"),
		})
		return err
	}
	var p notifPayload
	_ = json.Unmarshal(n.Payload, &p)
	body := firstNonEmpty(p.WaBody, p.Body)

	if err := d.wa.Send(ctx, Message{Phone: user.Phone.String, Body: body}); err != nil {
		_, ferr := q.MarkNotificationFailed(ctx, gen.MarkNotificationFailedParams{ID: n.ID, Error: textOf(err.Error())})
		if ferr != nil {
			return ferr
		}
		return nil
	}
	_, err = q.MarkNotificationSent(ctx, n.ID)
	return err
}

func textOf(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

func nowTs() pgtype.Timestamptz { return pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true} }

func pgtypeFuture(d time.Duration) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now().UTC().Add(d), Valid: true}
}
