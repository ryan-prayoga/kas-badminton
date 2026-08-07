-- name: CreateClaimRequest :one
-- target_user NULL = "daftar sebagai orang baru" (§7.3). requester_id SUDAH
-- terverifikasi OTP di titik ini (RequireAuth) — cuma belum anggota klub
-- ini, itulah kenapa endpoint ini TIDAK di belakang RequireClub biasa.
INSERT INTO claim_requests (club_id, requester_id, target_user)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListPendingClaimRequests :many
SELECT * FROM claim_requests WHERE club_id = $1 AND status = 'pending' ORDER BY created_at;

-- name: GetClaimRequest :one
SELECT * FROM claim_requests WHERE id = $1 AND club_id = $2;

-- name: DecideClaimRequest :one
UPDATE claim_requests SET status = $3, decided_by = $4, decided_at = now(), note = $5
WHERE id = $1 AND club_id = $2 AND status = 'pending'
RETURNING *;
