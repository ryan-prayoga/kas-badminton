-- +goose Up
-- DDL.sql baris 318-407. Indeks paling penting di seluruh skema:
-- game_players_unpaid_idx (payer_id, bukan user_id — §8.2) — "tagihanku"
-- jadi satu index scan. Jangan dihapus saat menyederhanakan skema.
CREATE TABLE games (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Tanggal di ZONA KLUB, bukan zona perangkat (PLAN.md §13).
  played_on   date NOT NULL,
  format      game_format NOT NULL DEFAULT 'ganda',
  notes       text,

  -- Skor OPSIONAL (§8.3). NULL = tidak dicatat.
  score_format score_format,
  winner_side  game_side,

  recorded_by uuid REFERENCES users(id),
  recorded_by_name text,                  -- fallback migrasi v2 (teks bebas)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  version     bigint NOT NULL DEFAULT 1,

  CONSTRAINT games_score_pair CHECK (
    (score_format IS NULL AND winner_side IS NULL) OR (score_format IS NOT NULL)
  )
);
CREATE INDEX games_club_date_idx ON games (club_id, played_on DESC)
  WHERE deleted_at IS NULL;

-- Baris per pemain — jumlahnya bebas (§8).
CREATE TABLE game_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- SIAPA MAIN.
  user_id     uuid NOT NULL REFERENCES users(id),
  -- SIAPA NANGGUNG (§8.2). Bawaannya sama dengan user_id.
  payer_id    uuid NOT NULL REFERENCES users(id),
  side        game_side NOT NULL,
  slot        smallint NOT NULL,
  -- Sudah dibulatkan ke atas ke ratusan (§9.5 aturan A).
  amount      bigint NOT NULL CHECK (amount >= 0),
  paid_at     timestamptz,
  paid_by     uuid REFERENCES users(id),
  -- Sanggahan (§9.4) — HAK PEMAIN, bukan penanggung.
  disputed_at timestamptz,
  dispute_note text,
  UNIQUE (game_id, side, slot),
  UNIQUE (game_id, user_id)
);

CREATE INDEX game_players_unpaid_idx
  ON game_players (club_id, payer_id)
  WHERE paid_at IS NULL AND disputed_at IS NULL;

CREATE INDEX game_players_game_idx  ON game_players (game_id);
CREATE INDEX game_players_user_idx  ON game_players (user_id);
CREATE INDEX game_players_payer_idx ON game_players (payer_id);

-- Skor per game, kalau dicatat (§8.3).
CREATE TABLE game_scores (
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_no  smallint NOT NULL CHECK (game_no BETWEEN 1 AND 3),
  score_a  smallint NOT NULL CHECK (score_a >= 0),
  score_b  smallint NOT NULL CHECK (score_b >= 0),
  PRIMARY KEY (game_id, game_no)
);

CREATE TABLE game_koks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  kok_type_id      uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  -- Snapshot: harga & nama dikunci di dalam game (PLAN.md §8).
  type_name        text,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  qty              int NOT NULL DEFAULT 1 CHECK (qty > 0)
);
CREATE INDEX game_koks_game_idx ON game_koks (game_id);

-- +goose Down
DROP TABLE game_koks;
DROP TABLE game_scores;
DROP TABLE game_players;
DROP TABLE games;
