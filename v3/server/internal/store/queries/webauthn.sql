-- name: CreateWebauthnCredential :one
-- session_id = sesi yang sedang aktif SAAT mendaftar (device_label & bearer
-- token yang dipakai memanggil register/verify) — dicabut bersama sesi itu
-- (§7.2.2, lihat auth.RevokeSession yang memanggil
-- DeleteWebauthnCredentialsBySession).
INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, aaguid, device_label, session_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListWebauthnCredentialsByUser :many
SELECT * FROM webauthn_credentials WHERE user_id = $1;

-- name: UpdateWebauthnCredentialSignCount :exec
-- sign_count naik tiap login sukses — dipakai mendeteksi kloning
-- authenticator (dua device beda pakai kredensial "sama" tanpa saling tahu).
UPDATE webauthn_credentials SET sign_count = $2, last_used_at = now() WHERE id = $1;

-- name: DeleteWebauthnCredentialsBySession :exec
DELETE FROM webauthn_credentials WHERE session_id = $1;

-- name: DeleteWebauthnCredentialsByUserExceptSession :exec
-- Dipakai bareng RevokeOtherSessions (§7.2.2 "keluarkan semua kecuali ini")
-- — kredensial passkey milik sesi-sesi yang ikut tercabut, ikut tercabut.
DELETE FROM webauthn_credentials AS wc
WHERE wc.user_id = $1
  AND wc.session_id IN (SELECT s.id FROM sessions AS s WHERE s.user_id = $1 AND s.id != $2);
