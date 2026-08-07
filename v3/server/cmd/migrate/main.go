// cmd/migrate menjalankan migrasi goose lewat library-nya, bukan CLI
// eksternal — migrasi ikut di-embed ke binary yang sama (satu binary,
// PLAN.md §4.1), dipakai di docker-compose (service "migrate") dan CI.
//
// WAJIB pakai kredensial role kok_migrate (BYPASSRLS) lewat
// MIGRATE_DATABASE_URL — bukan DATABASE_URL milik kok_app. Kalau memakai
// role aplikasi biasa, migrasi yang butuh CREATE TABLE/POLICY akan gagal
// karena kok_app sengaja tidak diberi hak itu (§6.2).
package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/logging"
	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/migrations"
)

func main() {
	if err := run(); err != nil {
		slog.Error("migrasi gagal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	logger := logging.New(envString("ENV", "dev"), envString("LOG_LEVEL", "info"))

	dsn := os.Getenv("MIGRATE_DATABASE_URL")
	if dsn == "" {
		return errors.New("MIGRATE_DATABASE_URL wajib diisi (kredensial role kok_migrate)")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return err
	}

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}

	before, err := goose.GetDBVersion(db)
	if err != nil {
		return err
	}

	if err := goose.Up(db, "."); err != nil {
		return err
	}

	after, err := goose.GetDBVersion(db)
	if err != nil {
		return err
	}
	logger.Info("migrasi selesai", "versi_sebelum", before, "versi_sesudah", after)
	return nil
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
