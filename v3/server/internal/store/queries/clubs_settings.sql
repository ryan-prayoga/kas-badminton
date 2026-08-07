-- name: UpdateClubSettings :one
-- Replace penuh, bukan merge — pemanggil (handler) yang menggabungkan field
-- lama+baru sebelum kirim, supaya "sumber kebenaran shape settings" tetap
-- satu tempat (defaultClubSettings di clubs.go), bukan dua jalur beda logic.
UPDATE clubs SET settings = $2, updated_at = now(), version = version + 1
WHERE id = $1 AND version = $3
RETURNING *;
