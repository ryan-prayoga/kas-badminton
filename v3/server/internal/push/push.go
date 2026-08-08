// Package push mengirim Web Push sungguhan lewat VAPID (PLAN.md §4.4,
// §10.2, §14 F8) — pembungkus tipis di atas webpush-go, sama semangat
// internal/notify.Notifier: satu interface kecil (Sender) supaya
// pemanggil (dispatcher) tidak bergantung pada pustaka pihak ketiga
// langsung, dan dev/test bisa pakai Fake tanpa VAPID key sungguhan.
package push

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Subscription — cermin push_subscriptions (endpoint + dua kunci dari
// PushSubscription browser). Bukan gen.PushSubscription langsung supaya
// paket ini tidak bergantung pada internal/store/gen (murni transport).
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// ErrSubscriptionGone — endpoint sudah tidak berlaku (404/410 dari
// layanan push browser, mis. user uninstall app atau ganti perangkat).
// Pemanggil (dispatcher) menghapus baris push_subscriptions saat lihat
// error ini — bukan retry, karena tidak akan pernah berhasil lagi.
var ErrSubscriptionGone = errors.New("push: subscription sudah tidak berlaku")

type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte) error
}

// VAPID adalah Sender produksi.
type VAPID struct {
	PublicKey  string
	PrivateKey string
	// Subject — "mailto:..." per spec VAPID, wajib diisi layanan push
	// buat menghubungi pemilik server kalau ada masalah.
	Subject string
}

func (v *VAPID) Send(ctx context.Context, sub Subscription, payload []byte) error {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      v.Subject,
		VAPIDPublicKey:  v.PublicKey,
		VAPIDPrivateKey: v.PrivateKey,
		TTL:             86400, // 1 hari — cukup buat orang yang offline semalam, tidak menumpuk selamanya
	})
	if err != nil {
		return fmt.Errorf("push: kirim gagal: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return ErrSubscriptionGone
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("push: status %d dari layanan push", resp.StatusCode)
	}
	return nil
}

// Fake — dev/CI, sama semangat notify.Fake: tidak pernah kontak jaringan
// sungguhan, cuma mencatat log. Dipakai kalau VAPID key belum disetel
// (PLAN.md §12 "lingkungan dev tanpa WA" — di sini dev tanpa push).
type Fake struct {
	Logger *slog.Logger
}

func NewFake(logger *slog.Logger) *Fake { return &Fake{Logger: logger} }

func (f *Fake) Send(_ context.Context, sub Subscription, payload []byte) error {
	f.Logger.Info("push.fake: notifikasi tidak dikirim, cuma dicatat",
		"endpoint", sub.Endpoint, "bytes", len(payload))
	return nil
}

var (
	_ Sender = (*VAPID)(nil)
	_ Sender = (*Fake)(nil)
)

// GenerateDevKeys bikin pasangan VAPID SEKALI PAKAI buat dev/CI yang
// belum menyetel VAPID_PUBLIC_KEY (cmd/api/main.go). Tujuannya BUKAN
// supaya push sungguhan terkirim di dev (Sender-nya tetap Fake) — ini
// supaya PushManager.subscribe() di browser tetap bisa dites ujung ke
// ujung (kunci publik harus kunci ECDSA P-256 yang sah, browser
// menolak string sembarangan) tanpa perlu VAPID key produksi.
func GenerateDevKeys() (publicKey, privateKey string, err error) {
	return webpush.GenerateVAPIDKeys()
}
