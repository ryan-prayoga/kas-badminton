-- name: ClubIDForInviteToken :one
-- Sama alasannya dengan ClubIDForJoinToken (club_links.sql) — dibungkus
-- supaya NULL jadi nol baris, bukan baris ber-NULL yang lolos Scan diam-diam.
SELECT club_id FROM (SELECT club_id_for_invite_token($1) AS club_id) t
WHERE club_id IS NOT NULL;

-- name: CreateInvite :one
INSERT INTO invites (club_id, token, phone, target_user, created_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInviteByToken :one
SELECT * FROM invites WHERE token = $1 AND used_at IS NULL AND expires_at > now();

-- name: ConsumeInvite :exec
UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1;
