-- +goose Up
-- DDL.sql baris 637-695.
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  failed     int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
CREATE INDEX push_subs_user_idx ON push_subscriptions (user_id);

CREATE TABLE notification_prefs (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = preferensi bawaan orang itu di semua klub; terisi = khusus satu klub.
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  push_on     boolean NOT NULL DEFAULT true,
  wa_on       boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (user_id, club_id, kind)
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  channel     notif_channel NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      notif_status NOT NULL DEFAULT 'queued',
  attempts    int NOT NULL DEFAULT 0,
  send_after  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  read_at     timestamptz,               -- pusat notifikasi in-app (§10.1)
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_queue_idx ON notifications (channel, send_after)
  WHERE status = 'queued';
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_wa_quota_idx ON notifications (club_id, sent_at)
  WHERE channel = 'wa' AND status = 'sent';

CREATE TABLE media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  path        text NOT NULL UNIQUE,       -- nama ter-hash di volume disk
  mime        text NOT NULL,
  bytes       bigint NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD CONSTRAINT users_photo_fk FOREIGN KEY (photo_id) REFERENCES media(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_photo_fk;
DROP TABLE media;
DROP TABLE notifications;
DROP TABLE notification_prefs;
DROP TABLE push_subscriptions;
