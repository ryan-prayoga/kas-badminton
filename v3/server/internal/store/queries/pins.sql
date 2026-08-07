-- name: UpsertPin :exec
INSERT INTO user_pins (user_id, pin_hash)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
  SET pin_hash = excluded.pin_hash, failed = 0, locked_until = NULL, updated_at = now();

-- name: GetPin :one
SELECT * FROM user_pins WHERE user_id = $1;

-- name: IncrementPinFailed :exec
UPDATE user_pins
SET failed = failed + 1,
    locked_until = CASE WHEN failed + 1 >= sqlc.arg(max_failed)::int
                         THEN now() + make_interval(mins => sqlc.arg(lock_minutes)::int)
                         ELSE locked_until END,
    updated_at = now()
WHERE user_id = sqlc.arg(user_id)::uuid;

-- name: ResetPinFailed :exec
UPDATE user_pins SET failed = 0, locked_until = NULL, updated_at = now()
WHERE user_id = $1;
