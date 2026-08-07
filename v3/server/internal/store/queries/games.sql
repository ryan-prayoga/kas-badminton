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
INSERT INTO expenses (club_id, amount, note, recorded_by)
VALUES ($1, $2, $3, $4)
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

-- name: ListGameKoksByGame :many
SELECT * FROM game_koks WHERE game_id = $1;

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

-- name: SumUnpaidByPayer :one
-- Query "tagihanku" — satu index scan lewat game_players_unpaid_idx
-- (indeks paling penting di seluruh skema, DDL.sql baris 371-379).
SELECT COALESCE(SUM(amount), 0)::bigint AS total
FROM game_players
WHERE club_id = $1 AND payer_id = $2 AND paid_at IS NULL AND disputed_at IS NULL;
