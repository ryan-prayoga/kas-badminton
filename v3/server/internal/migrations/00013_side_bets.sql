-- +goose Up
-- DDL.sql baris 616-631.
-- SENGAJA TIDAK PUNYA KOLOM RUPIAH. Begitu taruhan dinilai rupiah dan masuk
-- tagihan, uang kas klub tercampur urusan pribadi antar pemain. Tabel ini
-- tidak boleh muncul di laporan keuangan mana pun, tidak menyentuh
-- wallet_entries maupun payments (§8.4).
CREATE TABLE side_bets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  game_id     uuid REFERENCES games(id) ON DELETE SET NULL,
  -- Yang kalah berutang ke yang menang.
  debtor_id   uuid NOT NULL REFERENCES users(id),
  creditor_id uuid NOT NULL REFERENCES users(id),
  item        text NOT NULL CHECK (length(btrim(item)) > 0),  -- "2 Pocari"
  status      bet_status NOT NULL DEFAULT 'open',
  settled_at  timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT side_bets_not_self CHECK (debtor_id <> creditor_id)
);
CREATE INDEX side_bets_open_idx ON side_bets (club_id, debtor_id)
  WHERE status = 'open';

-- +goose Down
DROP TABLE side_bets;
