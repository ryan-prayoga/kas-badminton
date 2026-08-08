-- Migrasi v2 → v3 (PLAN.md §14 F10, cmd/migrate-v2). SEMUA insert di sini
-- pakai ID yang DITENTUKAN PEMANGGIL (deterministik dari id/nama v2 —
-- lihat internal/migratev2/ids.go), bukan gen_random_uuid() bawaan tabel
-- — itulah yang bikin migrasi ini IDEMPOTEN: dijalankan dua kali pakai
-- data v2 yang sama menghasilkan id v3 yang SAMA persis, jadi ON CONFLICT
-- DO NOTHING/DO UPDATE cukup buat aman diulang, tanpa tabel "sudah pernah
-- migrasi row mana" terpisah.

-- name: UpsertMigratedUser :one
-- status SELALU 'unclaimed' (§7.3 "akun bayangan... tanpa nomor") — user
-- v2 belum pernah diverifikasi WA, diklaim belakangan lewat alur yang
-- SUDAH ada (F4/3 join.go, F7 claim-requests). DO UPDATE (bukan DO
-- NOTHING) supaya tetap RETURNING baris yang sudah ada kalau dijalankan
-- ulang — pemanggil butuh id-nya buat baris lain yang mereferensikannya.
INSERT INTO users (id, display_name, status)
VALUES ($1, $2, 'unclaimed')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
RETURNING *;

-- name: UpsertMigrationMembership :exec
-- role default 'member' kecuali operator migrasi menandai satu nama
-- sebagai admin lewat --admin (cmd/migrate-v2/main.go) — klub baru butuh
-- MINIMAL satu admin supaya ada yang bisa menyetujui claim-request orang
-- lain (§7.3), chicken-egg kalau semua 'member'.
INSERT INTO memberships (club_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (club_id, user_id) DO NOTHING;

-- name: UpsertMigratedKokType :one
INSERT INTO kok_types (id, club_id, name, price_per_person, price_per_slop, stock, active)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: InsertMigratedGame :exec
-- score_format/winner_side selalu NULL — v2 TIDAK PERNAH menyimpan skor
-- main harian (StoredGame v2 tidak punya field itu, cuma turnamen yang
-- punya skor; lihat komentar migratev2/migrate.go).
INSERT INTO games (id, club_id, played_on, format, notes, recorded_by, recorded_by_name, created_at, updated_at)
VALUES ($1, $2, $3, 'ganda', $4, $5, $6, $7, $7)
ON CONFLICT (id) DO NOTHING;

-- name: InsertMigratedGamePlayer :exec
-- user_id = payer_id SELALU — v2 tidak punya konsep "dibayarin orang
-- lain" (§8.2 fitur BARU v3), jadi pemetaannya lurus.
INSERT INTO game_players (id, game_id, club_id, user_id, payer_id, side, slot, amount, paid_at, paid_by)
VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO NOTHING;

-- name: InsertMigratedGameKok :exec
INSERT INTO game_koks (id, game_id, club_id, kok_type_id, type_name, price_per_person, qty)
VALUES ($1, $2, $3, $4, $5, $6, 1)
ON CONFLICT (id) DO NOTHING;

-- name: InsertMigratedExpense :exec
INSERT INTO expenses (id, club_id, amount, kok_type_id, type_name, note, recorded_by, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO NOTHING;

-- name: InsertMigratedWalletEntry :exec
-- player_carry v2 → saldo deposit awal (§14 F10). kind 'topup', note
-- menandai asalnya jelas buat siapa pun yang baca jurnal nanti.
INSERT INTO wallet_entries (id, club_id, user_id, kind, amount, note)
VALUES ($1, $2, $3, 'topup', $4, 'Migrasi dari v2 (player_carry)')
ON CONFLICT (id) DO NOTHING;

-- name: CountMigratedGames :one
SELECT COUNT(*)::bigint FROM games WHERE club_id = $1;

-- name: SumUnpaidByPayerAllUsers :many
-- Verifikasi F10 "piutang per orang cocok" — total belum lunas PER
-- ORANG di klub hasil migrasi, dibandingkan hitungan sisi v2
-- (migratev2/verify.go). Pola WHERE sama SumUnpaidByPayer (games.sql)
-- tapi di-GROUP BY, bukan difilter satu payer.
SELECT payer_id, SUM(amount)::bigint AS total
FROM game_players
WHERE club_id = $1 AND paid_at IS NULL AND disputed_at IS NULL
GROUP BY payer_id;
