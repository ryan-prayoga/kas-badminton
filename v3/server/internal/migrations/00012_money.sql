-- +goose Up
-- DDL.sql baris 522-601.
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  amount       bigint NOT NULL CHECK (amount > 0),
  status       payment_status NOT NULL DEFAULT 'verified',
  method       payment_method,
  claimed_at   timestamptz,
  claimed_by   uuid REFERENCES users(id),
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT 1
);
CREATE INDEX payments_club_time_idx ON payments (club_id, created_at DESC);
CREATE INDEX payments_pending_idx ON payments (club_id, claimed_at)
  WHERE status = 'pending';

-- Baris tagihan yang ditutup satu pembayaran. Dipakai juga untuk mengunci
-- tagihan yang sedang diklaim dari potong otomatis (§9.5 aturan E).
CREATE TABLE payment_allocations (
  payment_id       uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  game_player_id   uuid REFERENCES game_players(id) ON DELETE CASCADE,
  match_charge_id  uuid REFERENCES match_kok_charges(id) ON DELETE CASCADE,
  tournament_id    uuid,
  fee_user_id      uuid,
  amount           bigint NOT NULL CHECK (amount > 0),
  CONSTRAINT payment_alloc_one_target CHECK (
    (game_player_id  IS NOT NULL)::int +
    (match_charge_id IS NOT NULL)::int +
    (tournament_id   IS NOT NULL)::int = 1
  ),
  FOREIGN KEY (tournament_id, fee_user_id)
    REFERENCES tournament_fees(tournament_id, user_id) ON DELETE CASCADE
);
CREATE INDEX payment_alloc_payment_idx ON payment_allocations (payment_id);
CREATE UNIQUE INDEX payment_alloc_gp_idx ON payment_allocations (game_player_id)
  WHERE game_player_id IS NOT NULL;
CREATE UNIQUE INDEX payment_alloc_mc_idx ON payment_allocations (match_charge_id)
  WHERE match_charge_id IS NOT NULL;

-- Ledger dompet, append-only. Saldo = SUM(amount) per (club_id, user_id).
CREATE TABLE wallet_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        wallet_kind NOT NULL,
  -- Positif menambah saldo, negatif mengurangi.
  amount      bigint NOT NULL CHECK (amount <> 0),
  payment_id  uuid REFERENCES payments(id) ON DELETE SET NULL,
  note        text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_balance_idx ON wallet_entries (club_id, user_id);
CREATE INDEX wallet_entries_time_idx    ON wallet_entries (club_id, created_at DESC);

-- Saldo tidak boleh minus (§9.1). Ditegakkan di DB supaya jalur mana pun —
-- termasuk skrip perbaikan manual — tidak bisa melanggarnya.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION wallet_no_negative() RETURNS trigger AS $$
DECLARE bal bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO bal
    FROM wallet_entries
   WHERE club_id = NEW.club_id AND user_id = NEW.user_id;
  IF bal < 0 THEN
    RAISE EXCEPTION 'saldo deposit tidak boleh minus (club=% user=% saldo=%)',
      NEW.club_id, NEW.user_id, bal;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER wallet_no_negative_trg
  AFTER INSERT ON wallet_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wallet_no_negative();

-- +goose Down
DROP TRIGGER wallet_no_negative_trg ON wallet_entries;
DROP FUNCTION wallet_no_negative();
DROP TABLE wallet_entries;
DROP TABLE payment_allocations;
DROP TABLE payments;
