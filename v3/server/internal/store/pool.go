// Package store adalah satu-satunya jalur ke Postgres (PLAN.md §6.2).
// Pemakai lain (handler, auth, dst) TIDAK boleh memegang *pgxpool.Pool
// sendiri — cuma lewat Store.WithClub / Store.WithinTx, supaya
// "SET LOCAL app.club_id" selalu dipasang sebelum query klub berjalan.
package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

// New membungkus pool yang sudah dibuka pemanggil (cmd/api, test helper).
// Store tidak membuka koneksinya sendiri supaya lifecycle pool (Close)
// tetap dipegang pemanggil.
func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) Close() {
	s.pool.Close()
}
