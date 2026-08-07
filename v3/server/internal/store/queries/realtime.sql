-- name: PgNotify :exec
-- Dipanggil internal/realtime.Bus.Publish di DALAM transaksi tenant yang
-- sama (WithClub/WithinTx) — Postgres menahan NOTIFY sampai COMMIT, jadi
-- subscriber SSE tidak pernah melihat event sebelum datanya benar-benar
-- tersimpan (PLAN.md §4.3).
SELECT pg_notify(sqlc.arg(channel)::text, sqlc.arg(payload)::text);
