-- Dompet deposit (PLAN.md §9.1, API.md §4 "Deposit"). Ledger append-only —
-- SumWalletBalance (games.sql) sudah ada sejak F5 (cuma baca, F5 belum
-- pernah menulis baris pertama). Query di sini yang menulisnya, plus
-- kandidat potong-otomatis (§9.5 aturan B/C) dan jurnal.

-- name: CreateWalletEntry :one
-- Satu baris ledger. Larangan minus ditegakkan DUA lapis: domain.AppendEntry
-- (dihitung sebelum panggil ini) DAN trigger DB wallet_no_negative
-- (DDL.sql) — baris ini gagal kalau keduanya dilewati.
INSERT INTO wallet_entries (club_id, user_id, kind, amount, payment_id, note, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListWalletEntries :many
-- Jurnal dompet satu orang, terbaru dulu. Cursor `before` (timestamptz) —
-- sqlc.narg supaya NULL berarti "dari awal" (halaman pertama).
SELECT * FROM wallet_entries
WHERE club_id = $1 AND user_id = $2
  AND (sqlc.narg(before)::timestamptz IS NULL OR created_at < sqlc.narg(before))
ORDER BY created_at DESC
LIMIT $3;

-- name: ListWalletDeductCandidates :many
-- Kandidat potong-otomatis (§9.5 aturan B) — tagihan main yang belum lunas
-- milik payer, lewat indeks yang sama dengan "tagihanku"
-- (game_players_unpaid_idx sudah mengecualikan disputed_at). g.created_at
-- ikut diambil buat orderKey planner (WalletDebtRef.CreatedAt) — pemenang
-- "paling lama" dipakai buat memutus seri best-fit.
SELECT gp.id, gp.amount, g.played_on, g.created_at
FROM game_players gp
JOIN games g ON g.id = gp.game_id
WHERE gp.club_id = $1 AND gp.payer_id = $2 AND gp.paid_at IS NULL
  AND gp.disputed_at IS NULL AND g.deleted_at IS NULL
ORDER BY g.played_on, g.created_at;

-- name: MarkGamePlayersDeducted :many
-- Menutup baris tagihan yang tersentuh rencana potong-otomatis. Sengaja
-- terpisah dari MarkGamePlayersPaid (games.sql) walau UPDATE-nya identik —
-- nama beda menandai KENAPA baris ini lunas (dompet, bukan bendahara catat
-- cash) buat pembaca kode; keduanya boleh konvergen lagi kalau kelak butuh
-- kolom pembeda (mis. paid_via enum).
UPDATE game_players
SET paid_at = now(), paid_by = sqlc.arg(paid_by)
WHERE club_id = sqlc.arg(club_id) AND id = ANY(sqlc.arg(ids)::uuid[])
  AND paid_at IS NULL AND disputed_at IS NULL
RETURNING id;
