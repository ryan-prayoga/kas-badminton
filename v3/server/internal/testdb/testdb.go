// Package testdb adalah helper test yang butuh Postgres sungguhan
// (leak-suite, idempotensi, RLS koneksi-dipakai-ulang — PLAN.md §6.2).
// Semua test yang memakai ini SKIP kalau TEST_DATABASE_URL tidak diset,
// supaya `go test ./...` tetap hijau tanpa DB lokal; CI selalu menyetelnya
// (lihat .github/workflows/ci-v3.yml).
package testdb

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DSN mengembalikan TEST_DATABASE_URL (kredensial role kok_app — sama
// yang dipakai aplikasi, BUKAN kok_migrate) atau men-skip test.
func DSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL tidak diset — lewati test yang butuh Postgres")
	}
	return dsn
}

// Pool membuka pgxpool biasa (ukuran default) buat test yang tidak peduli
// identitas koneksi fisik.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, _ := PoolAndDSN(t)
	return pool
}

// PoolAndDSN dipakai test yang butuh pool DAN dsn mentahnya sekaligus
// (mis. internal/realtime.NewBus butuh dsn string sendiri buat koneksi
// LISTEN terpisah dari pool — internal/http test SSE end-to-end).
func PoolAndDSN(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := DSN(t)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("testdb: buka pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("testdb: ping: %v", err)
	}
	return pool, dsn
}

// SingleConnPool membuka pool dengan MaxConns=1 — dipakai test yang
// SENGAJA butuh dua transaksi berurutan berbagi satu koneksi fisik yang
// sama (internal/store/tenant_test.go, skenario "koneksi dipakai ulang"
// PLAN.md §6.2).
func SingleConnPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(DSN(t))
	if err != nil {
		t.Fatalf("testdb: parse config: %v", err)
	}
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("testdb: buka pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("testdb: ping: %v", err)
	}
	return pool
}
