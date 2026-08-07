-- +goose Up
-- DDL.sql baris 701-713.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  club_id     uuid REFERENCES clubs(id) ON DELETE SET NULL,  -- tetap ada walau klub dihapus (§12.2)
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason      text,
  visible_to_members boolean NOT NULL DEFAULT false,   -- mis. pemindahan nomor (§7.2.1)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_club_time_idx ON audit_log (club_id, created_at DESC);

-- +goose Down
DROP TABLE audit_log;
