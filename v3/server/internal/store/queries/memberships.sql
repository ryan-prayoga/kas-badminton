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
