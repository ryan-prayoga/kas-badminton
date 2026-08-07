-- +goose Up
-- Batalkan cepat (PLAN.md §9.4): undo main = HARD delete (bukan
-- soft-delete biasa) supaya jurnal tidak penuh "catat / batal catat" untuk
-- salah tap yang dikoreksi sedetik kemudian. games.game_players/game_koks/
-- game_scores sudah ON DELETE CASCADE (00010) — yang belum ikut kalau
-- game-nya dibuang adalah entri "pembulatan" di expenses (dibuat di
-- transaksi yang sama, §9.5 aturan A). game_id di sini membuat undo
-- membersihkannya lewat CASCADE juga, bukan lewat kode aplikasi menebak
-- baris expenses mana yang terkait.
ALTER TABLE expenses ADD COLUMN game_id uuid REFERENCES games(id) ON DELETE CASCADE;
CREATE INDEX expenses_game_idx ON expenses (game_id) WHERE game_id IS NOT NULL;

-- +goose Down
DROP INDEX expenses_game_idx;
ALTER TABLE expenses DROP COLUMN game_id;
