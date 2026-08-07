-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: CreateUser :one
-- Dipakai cuma oleh POST /api/v1/dev/login (TODO(F4): ganti alur OTP asli
-- yang membuat user lewat klaim/undangan, bukan langsung "active").
INSERT INTO users (phone, display_name, status)
VALUES ($1, $2, 'active')
RETURNING *;
