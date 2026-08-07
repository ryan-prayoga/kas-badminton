-- name: ClubIDForJoinToken :one
-- Lewat fungsi SECURITY DEFINER (00017) — SATU-SATUNYA cara resmi
-- menemukan club_id dari token sebelum RLS club_links bisa dibuka
-- (app.club_id belum ada di titik ini). Jangan query club_links langsung
-- di luar WithClub.
--
-- Dibungkus subquery + WHERE IS NOT NULL (bukan langsung `SELECT
-- club_id_for_join_token($1)`) supaya token yang tidak ketemu menghasilkan
-- NOL BARIS (pgx.ErrNoRows) — bukan satu baris berisi NULL. Scan NULL ke
-- uuid.UUID TIDAK error (google/uuid.Scan(nil) sengaja no-op), jadi tanpa
-- pembungkus ini pemanggil (resolveJoinToken) akan salah kira token
-- ketemu dengan club_id kosong (uuid.Nil) alih-alih mencoba tabel invites.
SELECT club_id FROM (SELECT club_id_for_join_token($1) AS club_id) t
WHERE club_id IS NOT NULL;

-- name: CreateClubLink :one
INSERT INTO club_links (club_id, purpose, token, label, expires_at, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListActiveClubLinks :many
SELECT * FROM club_links WHERE club_id = $1 AND active ORDER BY created_at DESC;

-- name: GetClubLink :one
SELECT * FROM club_links WHERE id = $1 AND club_id = $2;

-- name: GetClubLinkByToken :one
-- Dipakai GET/POST /join/{token} — PUBLIK, tanpa RequireClub (§6.4). Cuma
-- token aktif & belum kedaluwarsa yang boleh dipakai.
SELECT * FROM club_links
WHERE token = $1 AND active AND (expires_at IS NULL OR expires_at > now());

-- name: RotateClubLink :one
-- "Token QR bisa diputar ulang... poster lama otomatis mati" (§6.4) — token
-- lama diganti UUID baru, scan_count reset karena ini secara efektif tautan
-- baru.
UPDATE club_links SET token = $3, scan_count = 0
WHERE id = $1 AND club_id = $2
RETURNING *;

-- name: RevokeClubLink :exec
UPDATE club_links SET active = false WHERE id = $1 AND club_id = $2;

-- name: IncrementClubLinkScanCount :exec
UPDATE club_links SET scan_count = scan_count + 1 WHERE id = $1;
