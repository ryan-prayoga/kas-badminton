-- +goose Up
-- internal/migratev2 SyncOnce (cmd/sync-v2) — sync HIDUP v2 -> v3 selama
-- masa jalan-bareng (Ryan minta v2 & v3 hidup bersamaan, bukan freeze
-- v2 lalu migrasi sekali seperti rencana F10 asli). Beda dari Migrate()
-- one-shot: dipanggil ULANG-ULANG, jadi butuh tempat nyimpen "posisi
-- terakhir" buat nilai yang v3 sendiri tidak bisa turunkan ulang dari
-- baris yang sudah ada — sejauh ini cuma satu kasus: player_carry v2
-- (skalar tunggal, bukan ledger) harus jadi wallet_entries APPEND-ONLY
-- di v3, jadi tiap sync perlu tahu "carry v2 terakhir yang sudah jadi
-- wallet_entry" buat cuma menulis SELISIHnya.
--
-- key/value teks bebas (bukan tabel per keperluan) sengaja supaya
-- SyncOnce bisa nambah watermark baru nanti tanpa migrasi baru tiap
-- kali — polanya sama dengan wa_outbox: tabel kecil dipegang SATU
-- proses (cmd/sync-v2), bukan API publik, tapi TETAP RLS+club_id
-- (bukan longgar seperti wa_outbox) karena beririsan dengan tabel
-- ber-uang lain (wallet_entries) dan sync-v2 sudah masuk s.WithClub
-- yang sama seperti Migrate().
CREATE TABLE migratev2_sync_state (
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, key)
);

ALTER TABLE migratev2_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE migratev2_sync_state FORCE ROW LEVEL SECURITY;
CREATE POLICY migratev2_sync_state_tenant ON migratev2_sync_state
  USING (club_id = current_club()) WITH CHECK (club_id = current_club());
GRANT SELECT, INSERT, UPDATE, DELETE ON migratev2_sync_state TO kok_app;

-- +goose Down
REVOKE SELECT, INSERT, UPDATE, DELETE ON migratev2_sync_state FROM kok_app;
DROP POLICY IF EXISTS migratev2_sync_state_tenant ON migratev2_sync_state;
DROP TABLE migratev2_sync_state;
