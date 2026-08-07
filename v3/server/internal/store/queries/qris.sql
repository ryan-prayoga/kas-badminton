-- QRIS statis tersimpan per klub (clubs.merchant_qris) + jejak QR dinamis
-- (PLAN.md §9.6, F6/4).

-- name: UpdateClubMerchantQris :one
-- Replace + bump version, pola sama dgn UpdateClubSettings
-- (clubs_settings.sql) — If-Match (invarian §3.4) dicek lewat WHERE
-- version = $3; ErrNoRows berarti konflik, ditangani pemanggil.
UPDATE clubs SET merchant_qris = $2, updated_at = now(), version = version + 1
WHERE id = $1 AND version = $3
RETURNING *;

-- name: CreateQrisDynamicEvent :one
INSERT INTO qris_dynamic_events (club_id, amount, created_by, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ReportQrisDynamicRejected :one
-- Dua kali lapor pada QR yang sama TIDAK menimpa laporan pertama
-- (rejected_at IS NULL di WHERE) — "kejadian" dicatat sekali, sama
-- semangat DisputeGamePlayer (games.sql).
UPDATE qris_dynamic_events SET rejected_at = now()
WHERE id = $1 AND club_id = $2 AND rejected_at IS NULL
RETURNING *;
