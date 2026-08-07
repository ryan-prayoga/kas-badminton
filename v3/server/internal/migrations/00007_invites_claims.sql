-- +goose Up
-- DDL.sql baris 223-263.
CREATE TABLE club_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  purpose     link_purpose NOT NULL DEFAULT 'join',
  token       text NOT NULL UNIQUE,        -- diputar/dicabut → poster lama mati
  label       text,
  active      boolean NOT NULL DEFAULT true,
  expires_at  timestamptz,
  scan_count  bigint NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_links_club_idx ON club_links (club_id) WHERE active;

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  phone       text,                        -- diisi kalau undangan per-orang
  target_user uuid REFERENCES users(id),   -- akun bayangan yang mau diklaim
  created_by  uuid REFERENCES users(id),
  used_at     timestamptz,
  used_by     uuid REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_club_idx ON invites (club_id) WHERE used_at IS NULL;

CREATE TABLE claim_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user  uuid REFERENCES users(id),  -- NULL = mendaftar sebagai orang baru
  status       claim_status NOT NULL DEFAULT 'pending',
  decided_by   uuid REFERENCES users(id),
  decided_at   timestamptz,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_requests_pending_idx ON claim_requests (club_id)
  WHERE status = 'pending';

-- +goose Down
DROP TABLE claim_requests;
DROP TABLE invites;
DROP TABLE club_links;
