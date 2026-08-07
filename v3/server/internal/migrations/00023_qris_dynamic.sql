-- +goose Up
-- QRIS dinamis (PLAN.md §9.6, F6/4). SATU baris per QR dinamis yang
-- dibuat — dialog SELALU membuatnya ulang (tidak pernah cache, §9.6),
-- expires_at menegakkan itu di server juga (bukan cuma janji UI).
-- rejected_at diisi lewat report-rejected: "setelah beberapa minggu,
-- datanya sendiri yang memutuskan apakah QR dinamis layak dipertahankan."
CREATE TABLE qris_dynamic_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  amount      bigint NOT NULL CHECK (amount > 0),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  rejected_at timestamptz
);
CREATE INDEX qris_dynamic_events_club_time_idx ON qris_dynamic_events (club_id, created_at DESC);

ALTER TABLE qris_dynamic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qris_dynamic_events FORCE ROW LEVEL SECURITY;
CREATE POLICY qris_dynamic_events_tenant ON qris_dynamic_events
  USING (club_id = current_club()) WITH CHECK (club_id = current_club());
GRANT SELECT, INSERT, UPDATE, DELETE ON qris_dynamic_events TO kok_app;

-- +goose Down
REVOKE SELECT, INSERT, UPDATE, DELETE ON qris_dynamic_events FROM kok_app;
DROP POLICY IF EXISTS qris_dynamic_events_tenant ON qris_dynamic_events;
DROP TABLE qris_dynamic_events;
