-- name: CreateClub :one
-- id dikirim eksplisit (bukan DEFAULT gen_random_uuid()) supaya pemanggil
-- tahu club_id SEBELUM transaksi mulai — dipakai buat SET LOCAL
-- app.club_id di store.WithClub yang sama, jadi insert clubs + membership
-- admin pembuatnya atomik dalam satu transaksi (internal/http/clubs.go).
INSERT INTO clubs (id, slug, name, timezone, settings, quotas, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetClub :one
-- Tanpa club_id di WHERE — clubs tidak ber-RLS (tabel dirinya sendiri
-- bukan milik klub). Caller (RequireClub) sudah memverifikasi keanggotaan
-- lewat GetMembership sebelum ini dipanggil.
SELECT * FROM clubs WHERE id = $1 AND deleted_at IS NULL;

-- name: GetClubBySlug :one
SELECT * FROM clubs WHERE slug = $1 AND deleted_at IS NULL;
