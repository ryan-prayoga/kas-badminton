-- name: GetKokType :one
-- Dipakai POST games buat snapshot harga (§8 "harga & nama dikunci di
-- dalam game, tidak pernah diambil ulang dari katalog"). CRUD katalog
-- kok_types sendiri di luar lingkup F2 (slice sempit clubs+games) — kalau
-- kok_type_id tidak dikirim, klien boleh kirim type_name+price_per_person
-- ad-hoc (kolom kok_type_id di game_koks memang nullable).
SELECT * FROM kok_types WHERE id = $1 AND club_id = $2 AND active;

-- name: CreateKokType :one
-- Dipakai cmd/seed buat data contoh (CRUD katalog sendiri di luar F2).
INSERT INTO kok_types (club_id, name, price_per_person)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CountKokTypesByClub :one
-- Dipakai internal/store/tenant_test.go — sengaja query dengan club_id
-- eksplisit yang BEDA dari SET LOCAL app.club_id aktif, buat membuktikan
-- RLS tetap menahan meski filter aplikasinya "benar" (§6.2 lapisan
-- ketiga).
SELECT count(*) FROM kok_types WHERE club_id = $1;
