-- +goose Up
-- cmd/waworker (F4 bagian 6) adalah SATU-SATUNYA proses yang boleh
-- memegang koneksi whatsmeow (PLAN.md §12 "Bridge WA satu proses" — dua
-- instance akan bentrok). cmd/api tidak boleh mengimpor whatsmeow sama
-- sekali; ia cuma menitip pesan lewat tabel ini (notify.Outbox), waworker
-- yang memoles jadi kiriman WA sungguhan. Sengaja BUKAN tabel `notifications`
-- (F8, skema lebih kaya: user_id wajib, kind, channel per-kejadian) — di
-- titik OTP dikirim (internal/auth/otp.go) user_id belum tentu ada (user
-- baru dibuat saat verify, bukan saat request), jadi butuh tabel sendiri
-- yang bentuknya persis notify.Message: phone+body, tidak lebih.
CREATE TABLE wa_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued', -- queued | sent | failed
  attempts   int NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX wa_outbox_queued_idx ON wa_outbox (created_at) WHERE status = 'queued';

-- Satu baris (id selalu true) — waworker meng-upsert tiap beberapa detik
-- selama proses hidup, GET /admin/wa/health (F4/5) membacanya. Baris ini
-- TIDAK ADA artinya "waworker terhubung SEKARANG" kalau proses mati
-- mendadak tanpa sempat update — itu diketahui dari updated_at basi,
-- bukan dari nilai connected sendiri (dicek di notify.Outbox.Health).
CREATE TABLE wa_worker_heartbeat (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  connected  boolean NOT NULL DEFAULT false,
  detail     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO wa_worker_heartbeat (id, connected, detail) VALUES (true, false, 'waworker belum pernah jalan')
  ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON wa_outbox, wa_worker_heartbeat TO kok_app;

-- +goose Down
REVOKE SELECT, INSERT, UPDATE, DELETE ON wa_outbox, wa_worker_heartbeat FROM kok_app;
DROP TABLE wa_worker_heartbeat;
DROP TABLE wa_outbox;
