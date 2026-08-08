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

-- --- Turnamen (F10 lanjutan) ---

-- name: UpsertMigratedTournament :one
-- Tabel tournaments TIDAK punya recorded_by_name fallback teks (beda dari
-- games, DDL.sql) — recorded_by yang tidak cocok mapping selalu NULL di
-- sini, sama seperti expenses (§14 F10, komentar migratev2/types.go).
INSERT INTO tournaments (id, club_id, name, starts_on, ends_on, format, size, fee, score_format, notes, recorded_by, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
RETURNING *;

-- name: UpsertMigratedTournamentPair :one
INSERT INTO tournament_pairs (id, tournament_id, club_id, slot, player_a, player_b)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET slot = EXCLUDED.slot
RETURNING *;

-- name: UpsertMigratedTournamentFee :exec
INSERT INTO tournament_fees (tournament_id, club_id, user_id, amount, paid_at, paid_by)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (tournament_id, user_id) DO NOTHING;

-- name: InsertMigratedMatchKok :exec
INSERT INTO match_koks (id, club_id, tournament_id, match_id, kok_type_id, type_name, price_per_person, qty, used_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
ON CONFLICT (id) DO NOTHING;

-- name: InsertMigratedMatchKokCharge :exec
INSERT INTO match_kok_charges (id, club_id, tournament_id, match_id, user_id, amount, paid_at, paid_by, charged_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO NOTHING;

-- name: CountMigratedTournaments :one
SELECT COUNT(*)::bigint FROM tournaments WHERE club_id = $1;

-- name: CountMigratedPlayedMatches :one
-- "Partai" = match yang punya skor tercatat (F10 "jumlah game dan partai
-- cocok"). EXISTS match_games, bukan cuma baris matches — EnsureMatch
-- juga membuat baris buat match yang cuma punya kok tanpa skor.
SELECT COUNT(DISTINCT m.id)::bigint
FROM matches m
JOIN match_games mg ON mg.match_id = m.id
WHERE m.tournament_id = $1;

-- name: SumTournamentFees :one
SELECT COALESCE(SUM(amount), 0)::bigint FROM tournament_fees WHERE tournament_id = $1;

-- name: SumMatchKokCharges :one
SELECT COALESCE(SUM(amount), 0)::bigint FROM match_kok_charges WHERE tournament_id = $1;

-- name: SumUnpaidByPayerAllUsers :many
-- Verifikasi F10 "piutang per orang cocok" — total belum lunas PER
-- ORANG di klub hasil migrasi, dibandingkan hitungan sisi v2
-- (migratev2/verify.go). Pola WHERE sama SumUnpaidByPayer (games.sql)
-- tapi di-GROUP BY, bukan difilter satu payer.
SELECT payer_id, SUM(amount)::bigint AS total
FROM game_players
WHERE club_id = $1 AND paid_at IS NULL AND disputed_at IS NULL
GROUP BY payer_id;

-- --- Sync HIDUP v2->v3 (cmd/sync-v2, internal/migratev2/sync.go) ---
-- Beda dari INSERT/UPSERT di atas: dipanggil BERULANG dengan data v2
-- yang bisa BERUBAH (bukan cuma nambah), jadi pakai DO UPDATE di
-- tempat yang di one-shot sengaja DO NOTHING. Cakupan terbatas ke apa
-- yang rutin berubah setelah baris pertama kali tersync: status lunas
-- pemain/kok, dan metadata game (catatan, siapa yang mencatat).

-- name: GetSyncState :one
SELECT value FROM migratev2_sync_state WHERE club_id = $1 AND key = $2;

-- name: UpsertSyncState :exec
INSERT INTO migratev2_sync_state (club_id, key, value, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (club_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- name: UpsertSyncedGame :exec
-- Dipanggil HANYA kalau v2 games.updated_at berubah sejak sync
-- terakhir (SyncOnce yang mengecek, bukan query ini) — DO UPDATE aman
-- karena baris hasil cermin v2 tidak pernah diedit langsung dari v3
-- (kebijakan v2-induk, PLAN.md §14 F10 catatan sync hidup).
INSERT INTO games (id, club_id, played_on, format, notes, recorded_by, recorded_by_name, created_at, updated_at)
VALUES ($1, $2, $3, 'ganda', $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET
  played_on = EXCLUDED.played_on, notes = EXCLUDED.notes,
  recorded_by = EXCLUDED.recorded_by, recorded_by_name = EXCLUDED.recorded_by_name,
  updated_at = EXCLUDED.updated_at;

-- name: UpsertSyncedGamePlayer :exec
-- id deterministik per (game, slot) — TIDAK berubah walau pemain di
-- slot itu ganti/ganti status lunas, jadi DO UPDATE di sini yang
-- menangkap "ditandai lunas belakangan" (alur v2 paling umum), bukan
-- INSERT baru yang tidak akan pernah kena baris lama.
INSERT INTO game_players (id, game_id, club_id, user_id, payer_id, side, slot, amount, paid_at, paid_by)
VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id, payer_id = EXCLUDED.payer_id,
  side = EXCLUDED.side, slot = EXCLUDED.slot, amount = EXCLUDED.amount,
  paid_at = EXCLUDED.paid_at, paid_by = EXCLUDED.paid_by;

-- name: UpsertSyncedGameKok :exec
-- id turunan dari (typeID, pricePerPerson) — kalau harga kok di v2
-- diedit SETELAH baris ini pernah tersync, itu jadi id BARU (bukan
-- update baris lama) — kok lama yang tergantikan sengaja dibiarkan
-- (arsip pemakaian, bukan status hidup yang harus tepat satu per
-- game), sama semangat match_koks turnamen.
INSERT INTO game_koks (id, game_id, club_id, kok_type_id, type_name, price_per_person, qty)
VALUES ($1, $2, $3, $4, $5, $6, 1)
ON CONFLICT (id) DO UPDATE SET
  kok_type_id = EXCLUDED.kok_type_id, type_name = EXCLUDED.type_name,
  price_per_person = EXCLUDED.price_per_person;
