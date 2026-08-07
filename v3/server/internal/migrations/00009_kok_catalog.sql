-- +goose Up
-- DDL.sql baris 286-312.
CREATE TABLE kok_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name             text NOT NULL,
  price_per_person bigint NOT NULL CHECK (price_per_person >= 0),
  price_per_slop   bigint NOT NULL DEFAULT 0 CHECK (price_per_slop >= 0),
  stock            int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          bigint NOT NULL DEFAULT 1
);
CREATE INDEX kok_types_club_idx ON kok_types (club_id) WHERE active;

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Positif = kas keluar, negatif = kas masuk (penyesuaian saldo).
  amount      bigint NOT NULL,
  kok_type_id uuid REFERENCES kok_types(id) ON DELETE SET NULL,
  type_name   text,                       -- snapshot nama saat itu
  slops       int NOT NULL DEFAULT 0,
  note        text,
  recorded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_club_time_idx ON expenses (club_id, created_at DESC);

-- +goose Down
DROP TABLE expenses;
DROP TABLE kok_types;
