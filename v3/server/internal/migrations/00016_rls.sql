-- +goose Up
-- DDL.sql baris 719-753 (PLAN.md §6.2 — lapisan ketiga isolasi tenant).
-- Aplikasi WAJIB membuka transaksi lalu menjalankan
--   SET LOCAL app.club_id = '<uuid>';
-- sebelum query apa pun. SET LOCAL hilang sendiri saat transaksi selesai,
-- jadi koneksi yang dipakai ulang pool tidak mewarisi klub milik permintaan
-- sebelumnya — lihat internal/store/tenant.go.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION current_club() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.club_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kok_types','expenses','games','game_players','game_koks',
    'tournaments','tournament_pairs','matches','match_koks','match_kok_charges',
    'tournament_fees','payments','wallet_entries','club_links','invites',
    'claim_requests','user_aliases','memberships','audit_log','media',
    'side_bets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I USING (club_id = current_club()) '
      'WITH CHECK (club_id = current_club())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kok_app', t);
  END LOOP;
END $$;
-- +goose StatementEnd

-- Tabel lintas klub: tidak ber-RLS, dilindungi di lapisan aplikasi.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, webauthn_credentials, user_pins, otp_codes,
  push_subscriptions, notification_prefs, notifications,
  idempotency_keys, clubs, platform_admins, match_games, game_scores,
  payment_allocations
  TO kok_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kok_app;

-- +goose Down
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, webauthn_credentials, user_pins, otp_codes,
  push_subscriptions, notification_prefs, notifications,
  idempotency_keys, clubs, platform_admins, match_games, game_scores,
  payment_allocations
  FROM kok_app;
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM kok_app;

-- +goose StatementBegin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kok_types','expenses','games','game_players','game_koks',
    'tournaments','tournament_pairs','matches','match_koks','match_kok_charges',
    'tournament_fees','payments','wallet_entries','club_links','invites',
    'claim_requests','user_aliases','memberships','audit_log','media',
    'side_bets'
  ] LOOP
    EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON %I FROM kok_app', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I', t, t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
-- +goose StatementEnd

DROP FUNCTION current_club();
