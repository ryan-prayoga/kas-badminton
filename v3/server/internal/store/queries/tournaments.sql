-- F7 (PLAN.md §14): turnamen — bagan/klasemen, skor, kok per-partai & umum,
-- iuran. Bagan & klasemen sendiri TIDAK disimpan — dihitung ulang tiap baca
-- lewat internal/domain (BuildBracket/BuildRoundRobin) dari pairs+results,
-- persis pola v2. Tabel di sini cuma menyimpan input mentahnya.

-- name: CreateTournament :one
INSERT INTO tournaments (club_id, name, starts_on, ends_on, format, size, fee, score_format, notes, recorded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: ListTournamentsByClub :many
-- Cursor per tanggal mulai, sama pola ListGamesByClub.
SELECT * FROM tournaments
WHERE club_id = $1
  AND deleted_at IS NULL
  AND (sqlc.narg(before)::date IS NULL OR starts_on < sqlc.narg(before)::date)
ORDER BY starts_on DESC, id DESC
LIMIT $2;

-- name: GetTournament :one
SELECT * FROM tournaments WHERE id = $1 AND club_id = $2 AND deleted_at IS NULL;

-- name: UpdateTournament :one
-- API.md §5: PATCH cuma ubah fee & catatan. Versioning (invarian §3.4).
UPDATE tournaments
SET fee = $3, notes = $4, updated_at = now(), version = version + 1
WHERE id = $1 AND club_id = $2 AND version = $5 AND deleted_at IS NULL
RETURNING *;

-- name: CreateTournamentPair :one
INSERT INTO tournament_pairs (tournament_id, club_id, slot, player_a, player_b)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListTournamentPairsByTournament :many
SELECT * FROM tournament_pairs WHERE tournament_id = $1 ORDER BY slot;

-- name: EnsureMatch :one
-- Baris `matches` dibuat LAZY, pas skor atau kok pertama masuk — bagan
-- sendiri dihitung dari pairs+results tanpa butuh baris ini ada duluan
-- (lihat komentar berkas). ON CONFLICT DO UPDATE (bukan DO NOTHING) SENGAJA
-- — Postgres tidak RETURNING apa pun pada DO NOTHING yang konflik, padahal
-- pemanggil selalu butuh baris (baru atau lama) buat FK match_games/match_koks.
INSERT INTO matches (tournament_id, club_id, round, idx)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tournament_id, round, idx) DO UPDATE SET round = EXCLUDED.round
RETURNING *;

-- name: UpdateMatchResult :one
-- Cache hasil hitung domain (winner/auto_win) supaya bisa dibaca tanpa
-- rebuild bagan penuh kalau suatu saat dibutuhkan query langsung — sumber
-- kebenaran TETAP match_games+pairs, ini cuma salinan (lihat header berkas).
UPDATE matches
SET winner_side = $3, auto_win = $4, score_format = $5, played_on = $6, version = version + 1
WHERE id = $1 AND club_id = $2
RETURNING *;

-- name: ListMatchesByTournament :many
SELECT * FROM matches WHERE tournament_id = $1;

-- name: DeleteMatchGames :exec
DELETE FROM match_games WHERE match_id = $1;

-- name: CreateMatchGame :one
INSERT INTO match_games (match_id, game_no, score_a, score_b)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListMatchGamesByTournament :many
-- Gabungan match+skor buat membangun ulang StoredTournament.Results
-- (map[matchId]MatchScore) — round/idx dipetakan balik ke id string domain
-- di Go (tournaments.go matchDomainID), bukan di sini.
SELECT m.id AS match_id, m.round, m.idx, m.score_format AS match_score_format, m.played_on,
       mg.game_no, mg.score_a, mg.score_b
FROM match_games mg
JOIN matches m ON m.id = mg.match_id
WHERE m.tournament_id = $1
ORDER BY m.round, m.idx, mg.game_no;

-- name: CreateMatchKok :one
INSERT INTO match_koks (club_id, tournament_id, match_id, kok_type_id, type_name, price_per_person, qty, used_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMatchKoksByTournament :many
SELECT * FROM match_koks WHERE tournament_id = $1 ORDER BY used_on NULLS LAST, id;

-- name: CreateMatchKokCharge :one
INSERT INTO match_kok_charges (club_id, tournament_id, match_id, user_id, amount, charged_on)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListMatchKokChargesByTournament :many
SELECT * FROM match_kok_charges WHERE tournament_id = $1 ORDER BY charged_on, id;

-- name: MarkMatchKokChargesPaid :many
-- Sama pola MarkGamePlayersPaid (games.sql) — aksi massal boleh berhasil
-- sebagian, disputed tidak ikut kena.
UPDATE match_kok_charges
SET paid_at = now(), paid_by = $2
WHERE club_id = $1 AND id = ANY(sqlc.arg(ids)::uuid[])
  AND paid_at IS NULL AND disputed_at IS NULL
RETURNING id;

-- name: CreateTournamentFee :one
INSERT INTO tournament_fees (tournament_id, club_id, user_id, amount)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListTournamentFeesByTournament :many
SELECT * FROM tournament_fees WHERE tournament_id = $1 ORDER BY user_id;

-- name: MarkTournamentFeePaid :one
UPDATE tournament_fees
SET paid_at = now(), paid_by = $4
WHERE tournament_id = $1 AND club_id = $2 AND user_id = $3 AND paid_at IS NULL
RETURNING *;

-- name: ListUsersByIDs :many
SELECT * FROM users WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: CreateTournamentGuestMembership :one
-- Pasangan turnamen dari luar klub (§8.1 separuh kedua — beda dari
-- CreateUnclaimedUser di members/guest yang bikin user BARU): orangnya
-- sudah punya akun user (anggota klub lain, atau unclaimed hasil migrasi),
-- cuma belum jadi anggota klub INI. is_tournament_guest=true jadi penyaring
-- (memberships.sql ListMembers) supaya dia tidak ikut kehitung "anggota
-- biasa" di layar lain. Dipanggil SETELAH GetMembership memastikan belum
-- ada baris (handler tournaments.go) — races langka diterima sama seperti
-- pola CreateMembership lain di basis kode ini.
INSERT INTO memberships (club_id, user_id, role, is_tournament_guest)
VALUES ($1, $2, 'member', true)
RETURNING *;
