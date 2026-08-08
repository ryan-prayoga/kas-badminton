-- name: CreateSideBet :one
-- Taruhan barang (PLAN.md §8.4) — SENGAJA tidak ada kolom rupiah (lihat
-- header migrasi 00013_side_bets.sql). game_id nullable: taruhan boleh
-- lahir dari satu main tertentu ATAU berdiri sendiri ("siapa traktir
-- minum minggu ini").
INSERT INTO side_bets (club_id, game_id, debtor_id, creditor_id, item, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListSideBetsByClub :many
-- sqlc.narg(open_only) — NULL/false = semua taruhan, true = cuma yang
-- masih 'open'. Diurutkan terbaru dulu, sama pola daftar lain.
SELECT * FROM side_bets
WHERE club_id = $1
  AND (NOT sqlc.narg(open_only)::bool OR status = 'open')
ORDER BY created_at DESC;

-- name: GetSideBet :one
SELECT * FROM side_bets WHERE id = $1 AND club_id = $2;

-- name: UpdateSideBetStatus :one
-- Cuma dari 'open' — taruhan yang sudah settled/cancelled tidak bisa
-- ditimpa status lain (jurnal taruhan tetap jujur, sama semangat §9.4).
UPDATE side_bets
SET status = $3, settled_at = CASE WHEN $3 = 'settled'::bet_status THEN now() ELSE settled_at END
WHERE id = $1 AND club_id = $2 AND status = 'open'
RETURNING *;
