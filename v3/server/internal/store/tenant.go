package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ryan-prayoga/kas-badminton/v3/server/internal/store/gen"
)

// WithClub membuka transaksi, menjalankan "SET LOCAL app.club_id" lebih
// dulu, lalu memanggil fn dengan Queries yang tunduk RLS ke klub itu
// (PLAN.md §6.2). "SET LOCAL" otomatis hilang saat transaksi commit atau
// rollback — koneksi yang dipakai ulang pool TIDAK PERNAH mewarisi
// club_id milik permintaan sebelumnya. Ini SATU-SATUNYA jalan yang boleh
// dipakai untuk query tabel yang punya club_id.
func (s *Store) WithClub(ctx context.Context, clubID uuid.UUID, fn func(context.Context, *gen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op kalau sudah Commit

	// SET LOCAL sendiri tidak menerima parameter terikat ($1) — itu utility
	// statement, bukan DML (Postgres menolaknya dengan syntax error kalau
	// dipaksa). set_config(..., true) adalah padanan fungsi biasa yang BISA
	// diparameterkan dan tetap discope ke transaksi ini saja (argumen ketiga
	// true = is_local, identik semantiknya dengan SET LOCAL).
	if _, err := tx.Exec(ctx, "SELECT set_config('app.club_id', $1, true)", clubID.String()); err != nil {
		return fmt.Errorf("store: set local app.club_id: %w", err)
	}

	q := gen.New(tx)
	if err := fn(ctx, q); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: commit tx: %w", err)
	}
	return nil
}

// WithUser membuka transaksi lalu menjalankan "SET LOCAL app.user_id"
// (migrasi 00021) — dipakai KHUSUS buat GET /me (API.md §1) baca
// memberships milik pemanggil LINTAS klub, tanpa app.club_id diketahui
// lebih dulu. Policy memberships_tenant_read yang menegakkan "cuma baris
// milik user ini sendiri" (bukan Go) — lihat migrasi 00021 buat detail.
// JANGAN dipakai buat menulis memberships: policy tulisnya tetap murni
// club_id = current_club(), jadi INSERT/UPDATE/DELETE lewat sini akan
// ditolak RLS (fail-closed, sesuai desain).
func (s *Store) WithUser(ctx context.Context, userID uuid.UUID, fn func(context.Context, *gen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
		return fmt.Errorf("store: set local app.user_id: %w", err)
	}

	q := gen.New(tx)
	if err := fn(ctx, q); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: commit tx: %w", err)
	}
	return nil
}

// WithinTx membuka transaksi biasa, TANPA club_id — cuma untuk tabel
// lintas klub yang tidak ber-RLS: users, sessions, clubs, idempotency_keys,
// platform_admins, dan sejenisnya (lihat grant di
// internal/migrations/00016_rls.sql). Jangan dipakai untuk tabel yang
// punya kolom club_id — pakai WithClub.
func (s *Store) WithinTx(ctx context.Context, fn func(context.Context, *gen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := gen.New(tx)
	if err := fn(ctx, q); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: commit tx: %w", err)
	}
	return nil
}
