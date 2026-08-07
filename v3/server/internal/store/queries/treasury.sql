-- Tiga kantong uang (PLAN.md §9.2) — dipisah karena deposit adalah
-- KEWAJIBAN klub (bisa ditarik pemiliknya), bukan pemasukan; iuran
-- turnamen pool terpisah per turnamen. Menggabungkannya bikin kas
-- terlihat gemuk padahal sebagiannya bukan hak klub.

-- name: SumPaidKokIncome :one
-- "Uang kok yang sudah dibayar" — main harian (game_players) DAN kok
-- yang dibeli di sela partai turnamen (match_kok_charges, F7). Iuran
-- turnamen (tournament_fees) SENGAJA tidak ikut di sini — itu kantong
-- terpisah (SumTournamentFeesPaid).
SELECT (
  COALESCE((SELECT SUM(gp.amount) FROM game_players gp WHERE gp.club_id = $1 AND gp.paid_at IS NOT NULL), 0) +
  COALESCE((SELECT SUM(mc.amount) FROM match_kok_charges mc WHERE mc.club_id = $1 AND mc.paid_at IS NOT NULL), 0)
  )::bigint AS total;

-- name: SumExpenses :one
-- Positif = kas keluar, negatif = kas masuk (DDL.sql) — jumlahnya
-- langsung dikurangkan dari SumPaidKokIncome, bukan dipisah signed.
SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM expenses WHERE club_id = $1;

-- name: SumClubWalletTotal :one
-- Titipan pemain = jumlah SEMUA saldo deposit anggota klub ini, lintas
-- pemilik — kewajiban klub, bukan kas klub sendiri (§9.2).
SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM wallet_entries WHERE club_id = $1;

-- name: SumTournamentFeesPaid :one
-- Pool iuran turnamen (F7, belum ada handler yang menulis tabel ini —
-- selalu 0 sampai F7 tiba, query disiapkan sekarang biar treasury tidak
-- perlu diubah lagi nanti).
SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM tournament_fees WHERE club_id = $1 AND paid_at IS NOT NULL;

-- name: CreateManualExpense :one
-- Pengeluaran manual bendahara (API.md §4 "Catat pengeluaran / beli
-- slop") — beda dari CreateExpense (games.sql, khusus pembulatan
-- otomatis game_id): di sini kok_type_id/type_name/slops terisi, game_id
-- selalu NULL.
INSERT INTO expenses (club_id, amount, kok_type_id, type_name, slops, note, recorded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListExpenses :many
SELECT * FROM expenses
WHERE club_id = $1
  AND (sqlc.narg(before)::timestamptz IS NULL OR created_at < sqlc.narg(before))
ORDER BY created_at DESC
LIMIT $2;
