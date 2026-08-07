-- +goose Up
-- DDL.sql baris 108-165.
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL untuk akun bayangan / pemain tamu (§7.3, §8.1) — mereka punya
  -- riwayat dan tagihan tapi belum pernah diklaim, jadi belum punya nomor.
  phone        text UNIQUE
                 CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  username     citext UNIQUE
                 CONSTRAINT users_username_fmt CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  photo_id     uuid,
  status       user_status NOT NULL DEFAULT 'unclaimed',

  username_changed_at timestamptz,   -- jeda ganti username (§7.1)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT 1,

  -- Akun yang sudah diklaim wajib punya nomor; yang belum, wajib tidak punya.
  CONSTRAINT users_claimed_has_phone
    CHECK ((status = 'unclaimed' AND phone IS NULL) OR (status <> 'unclaimed' AND phone IS NOT NULL))
);

CREATE INDEX users_name_trgm_idx ON users USING gin (display_name gin_trgm_ops);

ALTER TABLE clubs
  ADD CONSTRAINT clubs_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);

-- Nama lama v2 → user, per klub. Nama yang sama di klub berbeda bisa orang
-- berbeda, jadi keunikannya per klub (§7.1).
CREATE TABLE user_aliases (
  club_id  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  alias    citext NOT NULL,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source   text NOT NULL DEFAULT 'v2',
  PRIMARY KEY (club_id, alias)
);
CREATE INDEX user_aliases_user_idx ON user_aliases (user_id);

CREATE TABLE memberships (
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             club_role NOT NULL DEFAULT 'member',
  role_expires_at  timestamptz,          -- peran sementara (§7.4)
  is_tournament_guest boolean NOT NULL DEFAULT false,  -- penyaring tamu (§8.1)
  auto_deduct      boolean NOT NULL DEFAULT true,      -- potong otomatis (§9.1)
  joined_at        timestamptz NOT NULL DEFAULT now(),
  left_at          timestamptz,
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE left_at IS NULL;
CREATE INDEX memberships_role_expiry_idx ON memberships (role_expires_at)
  WHERE role_expires_at IS NOT NULL;

CREATE TABLE platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE platform_admins;
DROP TABLE memberships;
DROP TABLE user_aliases;
ALTER TABLE clubs DROP CONSTRAINT clubs_created_by_fk;
DROP TABLE users;
