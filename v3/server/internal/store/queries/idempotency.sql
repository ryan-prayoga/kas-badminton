-- name: ReserveIdempotencyKey :one
-- Klaim kunci lebih dulu (response masih NULL) sebelum handler jalan.
-- ON CONFLICT DO NOTHING + baris kosong di hasil berarti kunci itu sudah
-- dipegang permintaan lain (invarian §3.3) — caller cek row count.
INSERT INTO idempotency_keys (key, user_id, club_id, endpoint, request_hash, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (key) DO NOTHING
RETURNING *;

-- name: GetIdempotencyKey :one
SELECT * FROM idempotency_keys WHERE key = $1;

-- name: CompleteIdempotencyKey :exec
UPDATE idempotency_keys
SET response = $2, status_code = $3
WHERE key = $1;
