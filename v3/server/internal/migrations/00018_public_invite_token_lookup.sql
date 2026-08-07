-- +goose Up
-- Sama alasannya dengan 00017, buat `invites` (undangan per-orang, §7.3
-- jalur B) — token undangan juga wajib bisa di-resolve SEBELUM club_id
-- diketahui.
-- +goose StatementBegin
CREATE FUNCTION club_id_for_invite_token(p_token text) RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE sql STABLE AS $$
  SELECT club_id FROM invites
  WHERE token = p_token AND used_at IS NULL AND expires_at > now();
$$;
-- +goose StatementEnd

GRANT EXECUTE ON FUNCTION club_id_for_invite_token(text) TO kok_app;

-- +goose Down
DROP FUNCTION club_id_for_invite_token(text);
