// cmd/seed mengisi database dev dengan data contoh, supaya developer bisa
// jalan tanpa menyentuh WhatsApp produksi (PLAN.md §12: "Lingkungan dev
// tanpa WA. Notifier palsu ... plus data seed").
//
// F0 cuma menyiapkan koneksi + kerangka perintah. Baris seed sungguhan
// (klub contoh, pemain, beberapa game) menunggu skema F2 (DDL.sql belum
// dipecah jadi migrasi goose) dan domain F1.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/config"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
)

func main() {
	if err := run(); err != nil {
		slog.Error("seed gagal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.Env, cfg.LogLevel)

	if cfg.Env == "prod" {
		logger.Error("seed menolak jalan di ENV=prod — ini cuma buat dev")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return err
	}
	logger.Info("koneksi database ok", "database_url_host", "(disembunyikan dari log)")

	// TODO(F2): begitu migrasi goose dari DDL.sql jalan, seed klub contoh +
	// beberapa pemain + beberapa game di sini. Sengaja kosong di F0 karena
	// tabelnya belum ada.
	logger.Info("seed: belum ada tabel untuk diisi (menunggu F2) — cuma verifikasi koneksi")

	return nil
}
