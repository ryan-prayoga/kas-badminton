-- +goose Up
-- DDL.sql baris 171-217.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,      -- token mentah tak pernah disimpan
  device_label text,
  last_ip      inet,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx    ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx  ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE webauthn_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  bytea NOT NULL UNIQUE,
  public_key     bytea NOT NULL,
  sign_count     bigint NOT NULL DEFAULT 0,
  aaguid         bytea,
  device_label   text,
  session_id     uuid REFERENCES sessions(id) ON DELETE SET NULL,  -- dicabut bersama perangkat (§7.2.2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX webauthn_user_idx ON webauthn_credentials (user_id);

CREATE TABLE user_pins (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash    text NOT NULL,               -- argon2id
  failed      int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   bytea NOT NULL,
  purpose     text NOT NULL,               -- 'claim' | 'device' | 'change_phone'
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (phone, created_at DESC);

-- +goose Down
DROP TABLE otp_codes;
DROP TABLE user_pins;
DROP TABLE webauthn_credentials;
DROP TABLE sessions;
