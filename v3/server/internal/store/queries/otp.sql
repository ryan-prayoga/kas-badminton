-- name: CreateOTP :one
INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CountRecentOTP :one
-- Rate limit kirim ulang (PLAN.md §7.2) — dihitung dari SEMUA kode yang
-- diminta di jendela waktu, bukan cuma yang masih aktif, supaya spam
-- kirim-lalu-tunggu-kadaluwarsa tidak lolos dari hitungan.
SELECT count(*) FROM otp_codes
WHERE phone = $1 AND created_at > $2;

-- name: GetLatestActiveOTP :one
-- Kode terbaru yang belum kedaluwarsa & belum dipakai buat nomor itu — TANPA
-- filter purpose, karena POST /auth/otp/verify (API.md §1) cuma menerima
-- {phone, code}. purpose disimpan buat audit/log kirimnya, bukan dicocokkan
-- lagi saat verifikasi. Kalau user minta ulang, kode sebelumnya otomatis
-- kalah dipakai (created_at DESC LIMIT 1) — cuma satu kode aktif per nomor.
SELECT * FROM otp_codes
WHERE phone = $1
  AND consumed_at IS NULL AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementOTPAttempts :exec
UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1;

-- name: ConsumeOTP :exec
UPDATE otp_codes SET consumed_at = now() WHERE id = $1;
