-- name: EnqueueWaMessage :one
INSERT INTO wa_outbox (phone, body) VALUES ($1, $2) RETURNING *;

-- name: ClaimQueuedWaMessages :many
-- SKIP LOCKED — aman kalau suatu hari ada lebih dari satu waworker
-- berjalan singkat saat deploy (rolling), walau §12 tetap "satu proses"
-- normalnya. FOR UPDATE mengunci baris yang diklaim sampai transaksi
-- commit, cegah dua worker kirim pesan yang sama dua kali.
SELECT * FROM wa_outbox
WHERE status = 'queued'
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkWaMessageSent :exec
UPDATE wa_outbox SET status = 'sent', sent_at = now() WHERE id = $1;

-- name: MarkWaMessageFailed :exec
UPDATE wa_outbox SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1;

-- name: UpsertWaHeartbeat :exec
UPDATE wa_worker_heartbeat SET connected = $1, detail = $2, updated_at = now() WHERE id = true;

-- name: GetWaHeartbeat :one
SELECT * FROM wa_worker_heartbeat WHERE id = true;
