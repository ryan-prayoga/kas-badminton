-- +goose Up
-- DDL.sql baris 269-280 (invarian §3.3).
CREATE TABLE idempotency_keys (
  key         text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  request_hash bytea NOT NULL,             -- kunci sama + isi beda = 409, bukan hasil lama
  response    jsonb,
  status_code int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

-- +goose Down
DROP TABLE idempotency_keys;
