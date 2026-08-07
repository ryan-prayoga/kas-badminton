-- +goose Up
-- Ekstensi yang dipakai seluruh skema v3 (lihat v3/DDL.sql baris 21-23).
-- Migrasi berikutnya (F2) memecah DDL.sql jadi berurutan mulai dari sini.
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- username & slug case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- pencarian nama (PLAN.md §5.4)

-- +goose Down
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
