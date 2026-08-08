-- Query khusus halaman publik klub (PLAN.md §6.3, §9). SATU aturan buat
-- seluruh berkas ini: TIDAK PERNAH SELECT nomor telepon (users.phone),
-- saldo deposit perorangan (wallet_entries per user_id), riwayat
-- pembayaran perorangan (payments), atau audit_log. Kalau sebuah kolom
-- ragu-ragu boleh publik atau tidak, JANGAN dimasukkan di sini — tambah di
-- query berpemilik yang sudah digerbang auth.

-- name: GetPublicClubStats :one
-- Statistik ringkas kartu "tentang klub" — jumlah anggota aktif, total
-- main tercatat, total turnamen. Tiga subquery independen (bukan JOIN)
-- supaya tidak ada perkalian baris antar tabel yang tidak berelasi.
SELECT
  (SELECT COUNT(*) FROM memberships m WHERE m.club_id = $1)::bigint AS member_count,
  (SELECT COUNT(*) FROM games g WHERE g.club_id = $1)::bigint AS game_count,
  (SELECT COUNT(*) FROM tournaments t WHERE t.club_id = $1)::bigint AS tournament_count;

-- name: ListPublicUnpaidTotals :many
-- "Rekap tagihan per nama" (§6.3) — SENGAJA cuma total per orang, bukan
-- baris per main: rincian tanggal/jumlah partai tetap privat, publik cuma
-- lihat siapa yang masih punya sisa dan berapa totalnya (sama semangat
-- dengan SumUnpaidByPayer, games.sql — disputed & pending_review
-- dikecualikan). display_name doang, TANPA users.phone.
SELECT u.id AS user_id, u.display_name, SUM(gp.amount)::bigint AS total_owed
FROM game_players gp
JOIN users u ON u.id = gp.payer_id
WHERE gp.club_id = $1 AND gp.paid_at IS NULL AND gp.disputed_at IS NULL
GROUP BY u.id, u.display_name
HAVING SUM(gp.amount) > 0
ORDER BY total_owed DESC, u.display_name ASC;
