-- name: GrantSuperadmin :exec
-- Belum ada endpoint HTTP buat ini (PLAN.md tidak menyebut alur
-- onboarding-nya — kemungkinan operator lewat psql langsung). Query ini
-- dipakai test (f7_test.go) dan tersedia buat tooling ops nanti.
INSERT INTO platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING;

-- name: IsSuperadmin :one
SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = $1);

-- name: ListClubsWithMemberCount :many
-- Metrik agregat (§7 API.md: "jumlah anggota, aktivitas") — superadmin
-- TIDAK boleh baca isi klub (§6.5), jadi cuma hitungan lewat
-- club_member_count() (migrasi 00019, SECURITY DEFINER sempit), bukan
-- subquery memberships langsung (ber-RLS, akan selalu nol tanpa
-- app.club_id — sama masalahnya dengan 00017/00018).
SELECT c.id, c.slug, c.name, c.status, c.created_at,
       club_member_count(c.id) AS member_count
FROM clubs c
WHERE c.deleted_at IS NULL
ORDER BY c.created_at DESC;

-- name: SuspendClub :one
UPDATE clubs SET status = 'suspended', updated_at = now(), version = version + 1
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: UpdateClubQuotas :one
-- Replace penuh, sama pola UpdateClubSettings (clubs_settings.sql) — merge
-- dilakukan di handler.
UPDATE clubs SET quotas = $2, updated_at = now(), version = version + 1
WHERE id = $1
RETURNING *;

-- name: CountQueuedNotifications :one
SELECT count(*) FROM notifications WHERE status = 'queued';

-- name: CountQueuedNotificationsByChannel :many
SELECT channel, count(*) AS n FROM notifications WHERE status = 'queued' GROUP BY channel;
