-- +goose Up
-- DDL.sql baris 67-102. FK clubs.created_by -> users(id) ditambahkan di
-- migrasi 00005 setelah tabel users ada.
CREATE TABLE clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        citext NOT NULL UNIQUE,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Jakarta',
  status      club_status NOT NULL DEFAULT 'active',

  -- Saklar per klub (PLAN.md §7.4, §10.3). Dibaca lewat helper bertipe di
  -- Go, jangan disebar sebagai akses map mentah.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Kuota (§12.1). Per klub supaya superadmin bisa menaikkan tanpa deploy.
  quotas      jsonb NOT NULL DEFAULT '{}'::jsonb,

  merchant_qris text,

  deleted_at  timestamptz,          -- soft-delete, tenggang 30 hari (§12.2)
  purge_after timestamptz,          -- diisi saat deleted_at diset
  created_by  uuid,                 -- FK ditambahkan setelah tabel users
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     bigint NOT NULL DEFAULT 1
);

CREATE INDEX clubs_active_idx ON clubs (status) WHERE deleted_at IS NULL;
CREATE INDEX clubs_purge_idx  ON clubs (purge_after) WHERE purge_after IS NOT NULL;

-- +goose Down
DROP TABLE clubs;
