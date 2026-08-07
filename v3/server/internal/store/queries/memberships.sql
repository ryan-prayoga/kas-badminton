-- name: CreateMembership :one
INSERT INTO memberships (club_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetMembership :one
-- Dipanggil di dalam WithClub (SET LOCAL app.club_id sudah aktif), jadi
-- RLS membatasi baris ke klub itu sendiri — filter user_id di sini adalah
-- lapisan aplikasi (kedua), RLS adalah lapisan ketiga (§6.2).
SELECT * FROM memberships
WHERE club_id = $1 AND user_id = $2 AND left_at IS NULL;

-- name: ListMembers :many
-- Pencarian nama/username (§5.4) — pg_trgm sudah aktif (00001_extensions).
-- sqlc.narg supaya q kosong ("") berarti "semua anggota", bukan filter yang
-- tak pernah cocok.
SELECT m.club_id, m.user_id, m.role, m.role_expires_at, m.is_tournament_guest,
       m.auto_deduct, m.joined_at, m.left_at,
       u.display_name, u.username, u.phone, u.status AS user_status
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.club_id = $1 AND m.left_at IS NULL
  AND (sqlc.narg(q)::text IS NULL OR sqlc.narg(q) = ''
       OR u.display_name ILIKE '%' || sqlc.narg(q) || '%'
       OR u.username ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY u.display_name;

-- name: UpdateMembershipRole :one
UPDATE memberships SET role = $3, role_expires_at = $4
WHERE club_id = $1 AND user_id = $2 AND left_at IS NULL
RETURNING *;

-- name: UpdateMembershipAutoDeduct :one
UPDATE memberships SET auto_deduct = $3
WHERE club_id = $1 AND user_id = $2 AND left_at IS NULL
RETURNING *;

-- name: ListMembershipsWithClubByUser :many
-- GET /me (API.md §1) — dipanggil lewat store.WithUser (migrasi 00021),
-- BUKAN WithClub: policy memberships_tenant_read mengizinkan baca lintas
-- klub selama user_id = current_user_id(). clubs sendiri tidak ber-RLS
-- (00016), jadi JOIN-nya aman dipanggil tanpa app.club_id sama sekali.
SELECT m.club_id, m.role, m.role_expires_at, m.auto_deduct,
       c.slug AS club_slug, c.name AS club_name
FROM memberships m
JOIN clubs c ON c.id = m.club_id
WHERE m.user_id = $1 AND m.left_at IS NULL AND c.deleted_at IS NULL
ORDER BY m.joined_at;
