// cmd/waworker — proses TERPISAH dari cmd/api, satu-satunya pemegang
// koneksi whatsmeow (PLAN.md §12 "Bridge WA satu proses" — dua instance
// akan bentrok). Baca pesan dari wa_outbox (ditulis notify.Outbox di
// cmd/api), kirim sungguhan lewat WhatsApp, tulis heartbeat yang dibaca
// GET /admin/wa/health (F4 bagian 5).
//
// CATATAN JUJUR: berkas ini TIDAK BISA diverifikasi jalan sungguhan di
// lingkungan pengembangan sesi ini — whatsmeow butuh pairing dengan nomor
// WA nyata (pindai QR dari HP asli). Ditulis mengikuti API whatsmeow yang
// diverifikasi lewat source paketnya (bukan cuma dokumentasi), dan
// polling-nya (claim FOR UPDATE SKIP LOCKED, WithinTx) diuji lewat suite
// yang sama dengan seluruh internal/store lainnya — tapi ceremony
// pairing+kirim pesan WA sungguhan sendiri belum pernah dijalankan.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // driver database/sql "pgx", dipakai sqlstore
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// pollInterval — jeda antar cek wa_outbox. Tidak perlu buru-buru; OTP
// sudah beres dalam hitungan detik masih terasa instan buat manusia.
const pollInterval = 3 * time.Second

// batchSize — pesan per putaran poll. Kuota harian 50 pesan/klub (§12.1)
// jauh di bawah ini; batas atas ini cuma jaring pengaman biar satu
// transaksi klaim tidak menahan ribuan baris sekaligus.
const batchSize = 20

func main() {
	if err := run(); err != nil {
		slog.Error("waworker berhenti dengan galat", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.Env, cfg.LogLevel)
	waLogger := waLog.Stdout("whatsmeow", cfg.LogLevel, cfg.IsDev())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("waworker: buka pool: %w", err)
	}
	defer pool.Close()
	s := store.New(pool)

	// sqlstore butuh koneksi database/sql-nya SENDIRI (bukan pgxpool kita)
	// — driver "pgx" di sini adalah pgx/v5/stdlib, BUKAN paket pgx yang
	// dipakai internal/store; keduanya sama-sama bicara ke DB yang sama
	// lewat protokol yang sama, cuma API Go-nya beda (database/sql vs pgx
	// native), whatsmeow cuma menerima yang pertama.
	waDB, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("waworker: buka koneksi sqlstore: %w", err)
	}
	defer waDB.Close()

	container := sqlstore.NewWithDB(waDB, "pgx", waLogger)
	if err := container.Upgrade(ctx); err != nil {
		return fmt.Errorf("waworker: migrasi skema whatsmeow: %w", err)
	}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return fmt.Errorf("waworker: ambil device: %w", err)
	}

	client := whatsmeow.NewClient(device, waLogger)

	if client.Store.ID == nil {
		if err := pairViaQRTerminal(ctx, client, logger); err != nil {
			return fmt.Errorf("waworker: pairing gagal: %w", err)
		}
	} else {
		if err := client.Connect(); err != nil {
			return fmt.Errorf("waworker: connect: %w", err)
		}
	}
	defer client.Disconnect()

	logger.Info("whatsmeow siap", "logged_in", client.IsLoggedIn(), "connected", client.IsConnected())

	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()
	pollTicker := time.NewTicker(pollInterval)
	defer pollTicker.Stop()

	writeHeartbeat(ctx, s, client, logger)

	for {
		select {
		case <-ctx.Done():
			logger.Info("sinyal berhenti diterima, menutup koneksi WA")
			_ = writeHeartbeatValues(context.Background(), s, false, "waworker dimatikan (sinyal berhenti)")
			return nil
		case <-heartbeatTicker.C:
			writeHeartbeat(ctx, s, client, logger)
		case <-pollTicker.C:
			if err := pollAndSend(ctx, s, client, logger); err != nil {
				logger.Error("gagal memproses wa_outbox", "err", err)
			}
		}
	}
}

// pairViaQRTerminal — device belum pernah login, tampilkan QR di terminal
// (skip2/go-qrcode.ToSmallString — sudah dipakai internal/poster, tidak
// nambah dependency) sampai operator memindai dari HP yang jadi nomor bot.
func pairViaQRTerminal(ctx context.Context, client *whatsmeow.Client, logger *slog.Logger) error {
	qrChan, err := client.GetQRChannel(ctx)
	if err != nil {
		return err
	}
	if err := client.Connect(); err != nil {
		return err
	}

	for evt := range qrChan {
		switch evt.Event {
		case "code":
			qr, err := qrcode.New(evt.Code, qrcode.Medium)
			if err != nil {
				logger.Error("gagal membuat QR pairing", "err", err)
				continue
			}
			fmt.Println("Pindai QR ini dari HP yang jadi nomor bot klub (WhatsApp > Perangkat Tertaut):")
			fmt.Println(qr.ToSmallString(false))
		case "success":
			logger.Info("pairing WA berhasil")
			return nil
		case "timeout":
			return errors.New("QR pairing kedaluwarsa sebelum dipindai")
		default:
			logger.Info("status pairing", "event", evt.Event)
		}
	}
	return errors.New("kanal QR tertutup sebelum pairing selesai")
}

func writeHeartbeat(ctx context.Context, s *store.Store, client *whatsmeow.Client, logger *slog.Logger) {
	connected := client.IsConnected() && client.IsLoggedIn()
	detail := fmt.Sprintf("connected=%v logged_in=%v", client.IsConnected(), client.IsLoggedIn())
	if err := writeHeartbeatValues(ctx, s, connected, detail); err != nil {
		logger.Error("gagal menulis heartbeat", "err", err)
	}
}

func writeHeartbeatValues(ctx context.Context, s *store.Store, connected bool, detail string) error {
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		return q.UpsertWaHeartbeat(ctx, gen.UpsertWaHeartbeatParams{Connected: connected, Detail: textArg(detail)})
	})
}

// pollAndSend — SATU transaksi: klaim (FOR UPDATE SKIP LOCKED) lalu kirim
// tiap pesan, supaya baris yang gagal terkirim tetap "queued" balik kalau
// prosesnya mati di tengah (rollback), bukan hilang diam-diam.
func pollAndSend(ctx context.Context, s *store.Store, client *whatsmeow.Client, logger *slog.Logger) error {
	return s.WithinTx(ctx, func(ctx context.Context, q *gen.Queries) error {
		msgs, err := q.ClaimQueuedWaMessages(ctx, batchSize)
		if err != nil {
			return err
		}
		for _, m := range msgs {
			jid := types.NewJID(stripPlus(m.Phone), types.DefaultUserServer)
			body := m.Body
			_, sendErr := client.SendMessage(ctx, jid, &waE2E.Message{Conversation: &body})
			if sendErr != nil {
				logger.Error("kirim WA gagal", "phone", m.Phone, "err", sendErr)
				if err := q.MarkWaMessageFailed(ctx, gen.MarkWaMessageFailedParams{ID: m.ID, Error: textArg(sendErr.Error())}); err != nil {
					return err
				}
				continue
			}
			if err := q.MarkWaMessageSent(ctx, m.ID); err != nil {
				return err
			}
			logger.Info("WA terkirim", "phone", m.Phone)
		}
		return nil
	})
}

// stripPlus — notify.Message.Phone selalu E.164 ("+62..."), JID WhatsApp
// makai nomor tanpa "+" di depan.
func stripPlus(phone string) string {
	if len(phone) > 0 && phone[0] == '+' {
		return phone[1:]
	}
	return phone
}

func textArg(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: s != ""}
}
