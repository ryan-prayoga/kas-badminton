-- name: CreateSession :one
INSERT INTO sessions (user_id, token_hash, device_label, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetSessionByTokenHash :one
SELECT * FROM sessions
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: TouchSession :exec
UPDATE sessions SET last_seen_at = now() WHERE id = $1;

-- name: ListSessionsByUser :many
-- Daftar perangkat aktif (PLAN.md §7.2.2) — terbaru dulu.
SELECT * FROM sessions
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
ORDER BY last_seen_at DESC;

-- name: GetSessionByID :one
SELECT * FROM sessions WHERE id = $1;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllSessionsByUser :exec
-- Pemindahan nomor (§7.2.1): "Semua sesi, passkey, dan PIN lama dicabut —
-- perangkat lama otomatis keluar".
UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeOtherSessions :exec
-- "Keluarkan semua kecuali ini" (§7.2.2).
UPDATE sessions SET revoked_at = now()
WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL;
