-- F8 (PLAN.md §14, §10) — router dua jalur (Push/WA), pusat notifikasi
-- in-app, preferensi, langganan Web Push. Baca komentar internal/notify
-- (Router, Dispatcher) buat alur lengkapnya — file ini cuma query mentah.

-- name: CreateNotification :one
INSERT INTO notifications (user_id, club_id, kind, channel, payload, status, send_after)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListNotificationsByUser :many
-- Pusat notifikasi in-app (API.md §6 "GET /me/notifications?unread=true").
-- sqlc.narg(unread_only) — true = cuma read_at IS NULL.
SELECT * FROM notifications
WHERE user_id = $1
  AND (NOT sqlc.narg(unread_only)::bool OR read_at IS NULL)
ORDER BY created_at DESC
LIMIT 50;

-- name: MarkNotificationRead :one
UPDATE notifications SET read_at = now()
WHERE id = $1 AND user_id = $2 AND read_at IS NULL
RETURNING *;

-- name: ListDueNotificationsByChannel :many
-- Diambil Dispatcher (internal/notify/dispatcher.go), satu channel per
-- polling — push dan wa dikirim lewat jalur yang beda-beda (push.Sender
-- vs notify.Notifier/wa_outbox), jadi tidak dicampur satu query.
SELECT * FROM notifications
WHERE status = 'queued' AND channel = $1 AND send_after <= now()
ORDER BY send_after
LIMIT $2;

-- name: MarkNotificationSent :one
UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1
WHERE id = $1
RETURNING *;

-- name: MarkNotificationFailed :one
UPDATE notifications SET status = 'failed', attempts = attempts + 1, error = $2
WHERE id = $1
RETURNING *;

-- name: RescheduleNotification :one
-- Push gagal SEMENTARA (bukan subscription mati) — antre ulang beberapa
-- menit lagi lewat send_after, bukan langsung 'failed'. attempts tetap
-- naik supaya ada batas retry (dicek Dispatcher, bukan di SQL).
UPDATE notifications SET attempts = attempts + 1, send_after = $2
WHERE id = $1
RETURNING *;

-- name: CountWaSentTodayByClub :one
-- Kuota WA per klub per hari (§12.1) — indeks notifications_wa_quota_idx
-- (00014) dibuat persis buat query ini.
SELECT count(*) FROM notifications
WHERE club_id = $1 AND channel = 'wa' AND status = 'sent'
  AND sent_at >= date_trunc('day', now());

-- name: GetNotificationPref :one
-- club_id nullable — pemanggil coba baris khusus klub dulu, NULL kalau
-- tidak ketemu, lalu coba lagi dengan club_id=NULL (bawaan lintas klub)
-- di lapisan Go (dua query eksplisit lebih jelas daripada COALESCE ganda).
SELECT * FROM notification_prefs
WHERE user_id = $1 AND club_id IS NOT DISTINCT FROM sqlc.narg(club_id)::uuid AND kind = $2;

-- name: ListNotificationPrefsByUser :many
SELECT * FROM notification_prefs WHERE user_id = $1 ORDER BY club_id NULLS FIRST, kind;

-- name: UpsertNotificationPref :one
INSERT INTO notification_prefs (user_id, club_id, kind, push_on, wa_on)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, club_id, kind) DO UPDATE SET push_on = EXCLUDED.push_on, wa_on = EXCLUDED.wa_on
RETURNING *;

-- name: CreatePushSubscription :one
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ($1, $2, $3, $4)
ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failed = 0
RETURNING *;

-- name: ListPushSubscriptionsByUser :many
SELECT * FROM push_subscriptions WHERE user_id = $1;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2;

-- name: DeleteAllPushSubscriptionsByUser :exec
-- Hapus akun (§12, F9/4) — perangkat yang masih terpasang berhenti dapat
-- push begitu akun dihapus, sama semangat RevokeAllSessionsByUser.
DELETE FROM push_subscriptions WHERE user_id = $1;

-- name: DeletePushSubscriptionByEndpoint :exec
-- Dipakai Dispatcher pas push.ErrSubscriptionGone (404/410) — endpoint
-- yang menentukan identitas langganan di sisi browser, bukan id kita.
DELETE FROM push_subscriptions WHERE endpoint = $1;

-- name: IncrementPushSubscriptionFailed :one
UPDATE push_subscriptions SET failed = failed + 1 WHERE id = $1
RETURNING *;

-- name: MarkPushSubscriptionOk :exec
UPDATE push_subscriptions SET failed = 0, last_ok_at = now() WHERE id = $1;

-- name: ListActiveClubIDs :many
-- Scanner tunggakan (§10.3, internal/notify/overdue.go) — cuma klub aktif,
-- klub ditangguhkan/dihapus tidak perlu ditagih siapa pun.
SELECT id FROM clubs WHERE status = 'active' AND deleted_at IS NULL;

-- name: ListOverdueDebtorsByClub :many
-- Total tunggakan + tanggal tagihan TERTUA per payer, satu klub. Sama
-- pengecualian dgn SumUnpaidByPayer (games.sql): baris yang lagi
-- pending_review (diklaim, menunggu verifikasi) tidak ikut — orang itu
-- sudah bilang "sudah transfer", tidak perlu ditagih ulang lewat WA.
SELECT gp.payer_id, SUM(gp.amount)::bigint AS total_owed, MIN(g.played_on)::date AS earliest_unpaid
FROM game_players gp
JOIN games g ON g.id = gp.game_id
WHERE gp.club_id = $1 AND gp.paid_at IS NULL AND gp.disputed_at IS NULL AND g.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.game_player_id = gp.id AND p.status = 'pending'
  )
GROUP BY gp.payer_id;

-- name: GetLastDebtOverdueNotification :one
-- Jeda antar pengingat (§10.3 "satu orang tidak bisa ditagih dua kali
-- dalam seminggu") — baris terbaru APAPUN channel/statusnya (queued,
-- sent, atau bahkan skipped) tetap dihitung "sudah diingatkan", supaya
-- orang yang push+WA-nya mati berdua tidak diam-diam ditagih tiap jam
-- scanner jalan.
SELECT * FROM notifications
WHERE user_id = $1 AND club_id = $2 AND kind = 'debt_overdue'
ORDER BY created_at DESC LIMIT 1;
