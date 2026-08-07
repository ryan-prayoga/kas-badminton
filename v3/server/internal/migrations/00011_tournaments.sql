-- +goose Up
-- DDL.sql baris 413-516.
CREATE TABLE tournaments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date,
  format       tournament_format NOT NULL DEFAULT 'knockout',
  size         int NOT NULL CHECK (size BETWEEN 2 AND 32),
  fee          bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  score_format score_format NOT NULL DEFAULT 'single',
  notes        text,
  recorded_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT 1,
  CONSTRAINT tournaments_date_order CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX tournaments_club_date_idx ON tournaments (club_id, starts_on DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE tournament_pairs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  slot          int NOT NULL,
  -- NULL = slot BYE. Peserta dari luar klub tetap punya user (unclaimed) §8.1.
  player_a      uuid REFERENCES users(id),
  player_b      uuid REFERENCES users(id),
  UNIQUE (tournament_id, slot)
);
CREATE INDEX tournament_pairs_tour_idx ON tournament_pairs (tournament_id);

CREATE TABLE matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  round         int NOT NULL,
  idx           int NOT NULL,
  pair_a        uuid REFERENCES tournament_pairs(id) ON DELETE SET NULL,
  pair_b        uuid REFERENCES tournament_pairs(id) ON DELETE SET NULL,
  winner_side   game_side,
  auto_win      boolean NOT NULL DEFAULT false,
  score_format  score_format,
  played_on     date,
  version       bigint NOT NULL DEFAULT 1,
  UNIQUE (tournament_id, round, idx)
);
CREATE INDEX matches_tour_idx ON matches (tournament_id);

CREATE TABLE match_games (
  match_id  uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_no   smallint NOT NULL,
  score_a   smallint NOT NULL CHECK (score_a >= 0),
  score_b   smallint NOT NULL CHECK (score_b >= 0),
  PRIMARY KEY (match_id, game_no)
);

CREATE TABLE match_koks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  tournament_id    uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  -- NULL = kok umum turnamen — wajib punya penanggung, lihat match_kok_charges.
  match_id         uuid REFERENCES matches(id) ON DELETE CASCADE,
  kok_type_id      uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  type_name        text,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  qty              int NOT NULL DEFAULT 1 CHECK (qty > 0),
  used_on          date
);
CREATE INDEX match_koks_tour_idx  ON match_koks (tournament_id);
CREATE INDEX match_koks_match_idx ON match_koks (match_id);

-- Tagihan kok turnamen per orang. Menutup lubang kok lepas: kok umum
-- dibagi rata ke seluruh peserta, kok partai ditagih ke pemain partai itu.
CREATE TABLE match_kok_charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id      uuid REFERENCES matches(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  amount        bigint NOT NULL CHECK (amount >= 0),
  paid_at       timestamptz,
  paid_by       uuid REFERENCES users(id),
  disputed_at   timestamptz,
  charged_on    date NOT NULL
);
CREATE INDEX match_kok_charges_unpaid_idx
  ON match_kok_charges (club_id, user_id)
  WHERE paid_at IS NULL AND disputed_at IS NULL;

CREATE TABLE tournament_fees (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  amount        bigint NOT NULL CHECK (amount >= 0),
  paid_at       timestamptz,
  paid_by       uuid REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_fees_unpaid_idx ON tournament_fees (club_id, user_id)
  WHERE paid_at IS NULL;

-- +goose Down
DROP TABLE tournament_fees;
DROP TABLE match_kok_charges;
DROP TABLE match_koks;
DROP TABLE match_games;
DROP TABLE matches;
DROP TABLE tournament_pairs;
DROP TABLE tournaments;
