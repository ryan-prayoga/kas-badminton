-- Pembayaran dua langkah (PLAN.md §9.3, API.md §4). payment_allocations
-- dobel-fungsi: baris "tagihan mana yang ditutup pembayaran ini" DAN kunci
-- yang mencegah potong-otomatis menyentuhnya sementara menunggu verifikasi
-- (§9.5 aturan E) — indeks unik payment_alloc_gp_idx (DDL.sql) memastikan
-- satu game_player_id cuma dikunci SATU payment aktif dalam sejarahnya.

-- name: GetClaimableGamePlayers :many
-- Validasi item_ids (§4 "Sudah transfer") SEKALIGUS jadi query lock-check:
-- baris yang sudah lunas, disanggah, atau sedang dikunci payment pending
-- lain otomatis TIDAK ikut — pemanggil tahu klaimnya parsial dari selisih
-- panjang hasil vs item_ids yang diminta.
SELECT gp.id, gp.amount
FROM game_players gp
WHERE gp.club_id = sqlc.arg(club_id) AND gp.payer_id = sqlc.arg(payer_id)
  AND gp.id = ANY(sqlc.arg(ids)::uuid[])
  AND gp.paid_at IS NULL AND gp.disputed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.game_player_id = gp.id AND p.status = 'pending'
  );

-- name: CreatePayment :one
INSERT INTO payments (club_id, user_id, amount, status, method, claimed_at, claimed_by, note)
VALUES ($1, $2, $3, 'pending', $4, now(), $5, $6)
RETURNING *;

-- name: CreatePaymentAllocation :one
INSERT INTO payment_allocations (payment_id, game_player_id, amount)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetPayment :one
SELECT * FROM payments WHERE id = $1 AND club_id = $2;

-- name: ListPaymentAllocationsByPayment :many
SELECT * FROM payment_allocations WHERE payment_id = $1;

-- name: DeletePaymentAllocations :exec
-- Melepas kunci (§9.5 aturan E "kalau ditolak, kuncinya lepas") — WAJIB
-- dipanggil saat reject/cancel, BUKAN cuma mengubah payments.status: baris
-- alokasi yang tersisa akan mengunci game_player_id itu SELAMANYA lewat
-- payment_alloc_gp_idx (unique index tanpa filter status, DDL.sql) kalau
-- tidak dihapus — klaim ulang jadi mustahil. payments (induk) TETAP
-- disimpan (status=rejected) buat jurnal audit; cuma alokasinya yang lepas.
DELETE FROM payment_allocations WHERE payment_id = $1;

-- name: VerifyPayment :one
-- Cuma dari status pending (WHERE, bukan cek Go) — mencegah verifikasi
-- ganda kalau dua bendahara menekan tombol bersamaan; baris kedua dapat
-- ErrNoRows, ditangani pemanggil sebagai "sudah diproses".
UPDATE payments
SET status = 'verified', verified_at = now(), verified_by = $3
WHERE id = $1 AND club_id = $2 AND status = 'pending'
RETURNING *;

-- name: RejectPayment :one
-- Ditolak BENDAHARA (verified_by terisi) — beda dari CancelPayment
-- (pemain sendiri, verified_by tetap NULL) supaya jurnal audit membedakan
-- "ditolak orang lain" dari "dibatalkan sendiri".
UPDATE payments
SET status = 'rejected', verified_at = now(), verified_by = $3, note = $4
WHERE id = $1 AND club_id = $2 AND status = 'pending'
RETURNING *;

-- name: CancelPayment :one
-- Pemain BATALKAN klaim sendiri (API.md §4 "Batalkan klaim sendiri
-- sebelum diverifikasi") — user_id di WHERE memastikan cuma pengklaim
-- sendiri yang bisa, verified_by tetap NULL (lihat komentar RejectPayment).
UPDATE payments
SET status = 'rejected', verified_at = now(), note = $4
WHERE id = $1 AND club_id = $2 AND user_id = $3 AND status = 'pending'
RETURNING *;

-- name: MarkPaymentGamePlayersPaid :many
-- Menutup baris tagihan yang teralokasi ke payment yang baru diverifikasi.
-- disputed_at IS NULL dijaga lagi di sini (bukan cuma saat klaim) — kalau
-- baris itu disanggah SETELAH diklaim tapi SEBELUM diverifikasi, dia tetap
-- tertahan (§9.5 aturan D menang atas E): dilewati di sini, bukan
-- dipaksa lunas.
UPDATE game_players
SET paid_at = now(), paid_by = sqlc.arg(paid_by)
WHERE club_id = sqlc.arg(club_id) AND id = ANY(sqlc.arg(ids)::uuid[])
  AND paid_at IS NULL AND disputed_at IS NULL
RETURNING id;

-- name: ListClubBillItems :many
-- Rekap tagihan SELURUH anggota klub (API.md §4 "GET bills?status=unpaid",
-- bendahara) — status (unpaid/pending_review/disputed) dan payment_id
-- (kalau pending_review, buat POST payments/{id}/verify) dihitung di Go
-- dari disputed_at + payment_status di sini, sama pola dgn handleGetMyBill.
-- p.id (bukan pa.payment_id) — lihat komentar sama di
-- ListUnpaidGamePlayersByPayer (games.sql): pa.payment_id tidak pernah
-- lepas begitu pernah diklaim, p.id lewat JOIN berfilter status='pending'
-- yang jadi sinyal benar "sedang menunggu".
SELECT gp.id, gp.payer_id, gp.amount, gp.disputed_at, g.played_on, gp.game_id,
       p.id AS payment_id, p.status AS payment_status, p.claimed_at
FROM game_players gp
JOIN games g ON g.id = gp.game_id
LEFT JOIN payment_allocations pa ON pa.game_player_id = gp.id
LEFT JOIN payments p ON p.id = pa.payment_id AND p.status = 'pending'
WHERE gp.club_id = $1 AND gp.paid_at IS NULL AND g.deleted_at IS NULL
ORDER BY g.played_on DESC, gp.id DESC;
