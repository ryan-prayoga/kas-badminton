-- name: CreateGame :one
INSERT INTO games (club_id, played_on, format, notes, score_format, winner_side, recorded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: CreateGamePlayer :one
INSERT INTO game_players (game_id, club_id, user_id, payer_id, side, slot, amount)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: CreateGameKok :one
INSERT INTO game_koks (game_id, club_id, kok_type_id, type_name, price_per_person, qty)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateGameScore :one
INSERT INTO game_scores (game_id, game_no, score_a, score_b)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateExpense :one
-- Dipakai buat mencatat kelebihan pembulatan biaya sebagai kas masuk
-- (§9.5 aturan A) — amount negatif = kas masuk (DDL.sql baris 303-304).
-- game_id (nullable, 00022) DIISI kalau baris ini lahir dari pembulatan
-- satu game — bikin batalkan cepat (§9.4) membersihkannya lewat CASCADE
-- pas game-nya di-hard-delete, bukan kode aplikasi menebak baris mana.
-- Pengeluaran manual bendahara (F6) tetap NULL di sini.
INSERT INTO expenses (club_id, amount, note, recorded_by, game_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListGamesByClub :many
-- Cursor per tanggal (§4.2 "daftar main dimuat per bulan"; API.md §0
-- paginasi cursor, bukan offset). sqlc.narg(before) NULL = dari yang
-- terbaru.
SELECT * FROM games
WHERE club_id = $1
  AND deleted_at IS NULL
  AND (sqlc.narg(before)::date IS NULL OR played_on < sqlc.narg(before)::date)
ORDER BY played_on DESC, id DESC
LIMIT $2;

-- name: GetGame :one
SELECT * FROM games WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL;

-- name: ListGamePlayersByGame :many
SELECT * FROM game_players WHERE game_id = $1 ORDER BY side, slot;

-- name: ListGamePlayersByGames :many
SELECT * FROM game_players WHERE game_id = ANY(sqlc.arg(game_ids)::uuid[]) ORDER BY side, slot;

-- name: SetGamePlayersPayer :many
-- Preset taruhan kok "yang kalah bayar kok" (§8.2, §8.4
-- POST games/{id}/settle-bet) — pindahkan payer_id SEMUA baris main ini
-- ke satu orang (handler yang memilih siapa, biasanya pemain pertama sisi
-- kalah). paid_at IS NULL: baris yang sudah lunas tidak masuk akal
-- dipindah penanggungnya lagi.
UPDATE game_players
SET payer_id = $3
WHERE game_id = $1 AND club_id = $2 AND paid_at IS NULL AND disputed_at IS NULL
RETURNING *;

-- name: ListGameKoksByGame :many
SELECT * FROM game_koks WHERE game_id = $1;

-- name: ListGameScoresByGame :many
SELECT * FROM game_scores WHERE game_id = $1 ORDER BY game_no;

-- name: UpdateGame :one
-- Versioning (invarian §3.4): 0 baris kalau version klien sudah basi —
-- caller lalu fetch entitas terbaru dan balas 409 version_conflict.
UPDATE games
SET notes = $3, updated_at = now(), version = version + 1
WHERE id = $1 AND club_id = $2 AND version = $4 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteGame :one
UPDATE games
SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: HardDeleteGame :execrows
-- Batalkan cepat (§9.4) — BUKAN SoftDeleteGame di atas. Yang dibatalkan
-- dalam jendela 8 detik benar-benar hilang (cascade ke game_players,
-- game_koks, game_scores, dan expenses.game_id — 00010, 00022), supaya
-- jurnal tidak penuh pasangan "catat / batal catat" untuk salah tap.
-- Lewat jendela itu, koreksi lewat edit/hapus biasa (SoftDeleteGame).
-- recorded_by dicek di sini juga (bukan cuma di handler) — hanya yang
-- mencatat main ini yang boleh membatalkannya.
DELETE FROM games WHERE id = $1 AND club_id = $2 AND recorded_by = $3;

-- name: ListGamePlayersByUserForExport :many
-- Ekspor data pribadi (§12 "Hapus akun & ekspor data pribadi", F9/4) —
-- SEMUA baris tagihan orang ini di klub ini, apa pun statusnya (beda dari
-- SumUnpaidByPayer/ListUnpaidGamePlayersByPayer di bawah yang cuma yang
-- belum lunas). payer_id, BUKAN user_id — orang mau tahu apa yang harus
-- DIA bayar, sekaligus baris yang dia MAIN tapi dibayarin orang lain
-- muncul lewat query terpisah kalau nanti dibutuhkan (di luar lingkup
-- F9/4: ekspor fokus ke kewajiban uang, bukan statistik main).
SELECT gp.id, gp.game_id, gp.amount, gp.paid_at, gp.disputed_at, g.played_on
FROM game_players gp
JOIN games g ON g.id = gp.game_id
WHERE gp.club_id = $1 AND gp.payer_id = $2
ORDER BY g.played_on DESC;

-- name: SumUnpaidByPayer :one
-- Query "tagihanku" — satu index scan lewat game_players_unpaid_idx
-- (indeks paling penting di seluruh skema, DDL.sql baris 371-379). NOT
-- EXISTS payment pending TIDAK ikut total (F6/2, §9.3): sudah diklaim
-- "sudah transfer" berarti dari sisi pemain dia sudah bayar — sama alasan
-- disputed dikecualikan, supaya total tidak terasa mengabaikan laporannya.
SELECT COALESCE(SUM(amount), 0)::bigint AS total
FROM game_players gp
WHERE gp.club_id = $1 AND gp.payer_id = $2 AND gp.paid_at IS NULL AND gp.disputed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.game_player_id = gp.id AND p.status = 'pending'
  );

-- name: ListUnpaidGamePlayersByPayer :many
-- Baris-baris "tagihanku" (API.md §4 GET .../me/bill `items`), pasangan
-- dari SumUnpaidByPayer di atas — ikut nampilin yang disputed ATAU
-- pending_review (status dihitung di Go), tapi keduanya TETAP TIDAK ikut
-- total_owed (itu SumUnpaidByPayer, WHERE-nya beda).
-- p.id (bukan pa.payment_id) sengaja dipilih: pa.payment_id tetap terisi
-- SELAMANYA begitu pernah diklaim (baris alokasi tidak dihapus), sedangkan
-- p.id lewat JOIN yang difilter status='pending' cuma terisi SELAGI
-- menunggu — itulah sinyal pending_review yang benar.
SELECT gp.id, gp.game_id, gp.amount, gp.disputed_at, g.played_on,
       p.id AS payment_id, p.claimed_at
FROM game_players gp
JOIN games g ON g.id = gp.game_id
LEFT JOIN payment_allocations pa ON pa.game_player_id = gp.id
LEFT JOIN payments p ON p.id = pa.payment_id AND p.status = 'pending'
WHERE gp.club_id = $1 AND gp.payer_id = $2 AND gp.paid_at IS NULL AND g.deleted_at IS NULL
ORDER BY g.played_on DESC, gp.id DESC;

-- name: MarkGamePlayersPaid :many
-- Aksi massal "tandai lunas" (API.md §0 "boleh berhasil sebagian" + §4
-- POST bills/mark-paid) — dipanggil BENDAHARA (perm.ManageMoney) yang
-- mencatat uang cash diterima dari anggota lain, BUKAN pemain menandai
-- tagihan sendiri (itu jalur payments/claim + verifikasi, F6). Filter
-- club_id di WHERE (dari WithClub) + id di daftar yang diminta; disputed
-- sengaja tidak ikut kena — harus diselesaikan dulu sebelum ditandai lunas.
UPDATE game_players
SET paid_at = now()
WHERE club_id = $1 AND id = ANY(sqlc.arg(ids)::uuid[])
  AND paid_at IS NULL AND disputed_at IS NULL
RETURNING id;

-- name: DisputeGamePlayer :one
-- Sanggahan (§9.4) — HAK PEMAIN (user_id), bukan penanggung (payer_id).
-- Yang berhak bilang "saya tidak ikut main" adalah orang yang namanya
-- dicatat. disputed_at IS NULL di WHERE — sanggah dua kali tidak menimpa
-- catatan pertama.
UPDATE game_players
SET disputed_at = now(), dispute_note = $4
WHERE game_id = $1 AND club_id = $2 AND user_id = $3 AND disputed_at IS NULL
RETURNING *;

-- name: ResolveGamePlayerDispute :one
-- Pencatat/bendahara menyelesaikan (API.md §3) — mengembalikan baris ke
-- alur normal (kena potong otomatis & tunggakan lagi, §9.5 aturan D).
UPDATE game_players
SET disputed_at = NULL, dispute_note = NULL
WHERE game_id = $1 AND club_id = $2 AND user_id = $3 AND disputed_at IS NOT NULL
RETURNING *;

-- name: SumWalletBalance :one
-- Saldo dompet = SUM ledger append-only (DDL.sql "Saldo tidak boleh
-- minus", ditegakkan trigger DB, bukan diasumsikan di sini). Tulis
-- ledgernya sendiri (deposit, potong otomatis) baru dibangun F6 — F5
-- cuma baca, selalu 0 sampai F6 nambah baris pertama.
SELECT COALESCE(SUM(amount), 0)::bigint AS balance
FROM wallet_entries
WHERE club_id = $1 AND user_id = $2;
