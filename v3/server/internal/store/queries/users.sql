-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: CreateUser :one
-- Dipanggil dari VerifyOTP (internal/auth/otp.go) begitu nomor terverifikasi
-- — langsung 'active' karena OTP SUDAH membuktikan pemilik nomor
-- (bukan status 'unclaimed', itu cuma untuk akun bayangan hasil migrasi
-- v2 yang belum pernah diverifikasi siapa pun, §7.3).
INSERT INTO users (phone, display_name, status)
VALUES ($1, $2, 'active')
RETURNING *;
