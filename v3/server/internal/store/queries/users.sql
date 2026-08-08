-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserPhone :one
-- Pemindahan nomor oleh admin (§7.2.1) — constraint users_phone_e164 dan
-- UNIQUE(phone) di DDL sudah menegakkan format+keunikan, error 23505 kalau
-- nomor baru sudah dipakai user lain (ditangani di handler).
UPDATE users SET phone = $2, updated_at = now(), version = version + 1
WHERE id = $1
RETURNING *;

-- name: SearchUnclaimedByClub :many
-- "Pilih namanya dari daftar belum-terklaim" (§6.4 alur gabung klub) — akun
-- bayangan hasil migrasi v2, status masih 'unclaimed'.
SELECT u.* FROM users u
JOIN memberships m ON m.user_id = u.id
WHERE m.club_id = $1 AND m.left_at IS NULL AND u.status = 'unclaimed'
  AND (sqlc.narg(q)::text IS NULL OR sqlc.narg(q) = '' OR u.display_name ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY u.display_name
LIMIT 50;

-- name: CreateUnclaimedUser :one
-- Pemain tamu (§8.1) — pencatat mengetik nama yang tidak cocok anggota
-- mana pun, sistem bikin akun bayangan langsung di klub itu. phone NULL +
-- status 'unclaimed' (constraint users_phone_e164, DDL.sql ~baris 128).
-- Bisa diklaim belakangan lewat QR/tautan (SearchUnclaimedByClub di atas).
INSERT INTO users (display_name, status)
VALUES ($1, 'unclaimed')
RETURNING *;

-- name: AnonymizeUser :one
-- Hapus akun sendiri (§12 "Hapus akun & ekspor data pribadi", §12.2, F9/4,
-- migrasi 00024). Transaksi keuangan (game_players, payments,
-- wallet_entries) SENGAJA TIDAK disentuh di sini — tetap menempel ke
-- user_id ini lewat FK, cuma nama yang muncul di JOIN berubah jadi
-- "Pemain terhapus" secara otomatis. status='disabled' (BUKAN
-- 'unclaimed') supaya tidak muncul lagi di SearchUnclaimedByClub — akun
-- yang sudah dihapus pemiliknya sendiri tidak boleh diklaim ulang orang
-- lain (lihat komentar migrasi 00024).
UPDATE users
SET display_name = 'Pemain terhapus', phone = NULL, username = NULL,
    status = 'disabled', updated_at = now(), version = version + 1
WHERE id = $1
RETURNING *;

-- name: CreateUser :one
-- Dipanggil dari VerifyOTP (internal/auth/otp.go) begitu nomor terverifikasi
-- — langsung 'active' karena OTP SUDAH membuktikan pemilik nomor
-- (bukan status 'unclaimed', itu cuma untuk akun bayangan hasil migrasi
-- v2 yang belum pernah diverifikasi siapa pun, §7.3).
INSERT INTO users (phone, display_name, status)
VALUES ($1, $2, 'active')
RETURNING *;
