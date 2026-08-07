-- +goose Up
-- Semua enum yang dipakai skema (DDL.sql baris 44-61).
CREATE TYPE club_status       AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE user_status       AS ENUM ('unclaimed', 'active', 'disabled');
CREATE TYPE club_role         AS ENUM ('admin', 'bendahara', 'pencatat', 'verifikator', 'member');
CREATE TYPE game_format       AS ENUM ('single', 'ganda', 'rotasi');
CREATE TYPE game_side         AS ENUM ('a', 'b');
CREATE TYPE payment_status    AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE payment_method    AS ENUM ('qris_statis', 'qris_dinamis', 'transfer', 'tunai', 'deposit');
CREATE TYPE wallet_kind       AS ENUM ('topup', 'pemakaian', 'refund', 'penyesuaian');
CREATE TYPE tournament_format AS ENUM ('knockout', 'round_robin');
-- single  : satu game sampai 30 (format "biasa" v2)
-- bo3     : rally poin 21, best of 3
-- rally42 : satu game sampai 42, pindah tempat saat 21 — format tarkam (§8.3)
CREATE TYPE score_format      AS ENUM ('single', 'bo3', 'rally42');
CREATE TYPE bet_status        AS ENUM ('open', 'settled', 'cancelled');
CREATE TYPE notif_channel     AS ENUM ('push', 'wa', 'inapp');
CREATE TYPE notif_status      AS ENUM ('queued', 'sent', 'failed', 'skipped');
CREATE TYPE link_purpose      AS ENUM ('join', 'poster');
CREATE TYPE claim_status      AS ENUM ('pending', 'approved', 'rejected');

-- +goose Down
DROP TYPE claim_status;
DROP TYPE link_purpose;
DROP TYPE notif_status;
DROP TYPE notif_channel;
DROP TYPE bet_status;
DROP TYPE score_format;
DROP TYPE tournament_format;
DROP TYPE wallet_kind;
DROP TYPE payment_method;
DROP TYPE payment_status;
DROP TYPE game_side;
DROP TYPE game_format;
DROP TYPE club_role;
DROP TYPE user_status;
DROP TYPE club_status;
