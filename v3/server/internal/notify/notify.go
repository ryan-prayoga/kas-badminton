// Package notify mendefinisikan interface Notifier yang dipakai seluruh
// logika domain untuk mengirim OTP/notifikasi. Implementasi sungguhan
// (whatsmeow, Web Push) dipasang di F4/F8; di sini cuma kontrak + versi palsu
// buat dev (PLAN.md §12: "Lingkungan dev tanpa WA").
//
// Kenapa lewat interface: pindah ke Meta WhatsApp Cloud API nanti — atau
// nomor bot kena banned — tidak boleh menyentuh satu baris pun logika
// domain yang memanggil Notifier.
package notify

import (
	"context"
	"log/slog"
)

// Message adalah satu notifikasi yang mau dikirim ke satu nomor WA.
// Bentuknya sengaja minimal di F0 — router notifikasi (Push vs WA per
// kejadian) datang di F8.
type Message struct {
	Phone string // E.164, mis. +6281234567890
	Body  string
}

type Notifier interface {
	Send(ctx context.Context, msg Message) error
}

// Fake tidak pernah mengirim apa pun ke jaringan — dia cuma menulis pesan ke
// log. Dipakai di dev/CI supaya tidak ada yang perlu memakai nomor WA bot
// produksi untuk mengembangkan fitur (PLAN.md §12).
type Fake struct {
	Logger *slog.Logger
}

func NewFake(logger *slog.Logger) *Fake {
	return &Fake{Logger: logger}
}

func (f *Fake) Send(_ context.Context, msg Message) error {
	f.Logger.Info("notify.fake: pesan tidak dikirim, cuma dicatat",
		"phone", msg.Phone,
		"body", msg.Body,
	)
	return nil
}

var _ Notifier = (*Fake)(nil)
