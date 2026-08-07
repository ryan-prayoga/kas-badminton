-- +goose Up
-- club_links ber-RLS (00016) — kebijakan `club_id = current_club()` menolak
-- SEMUA baris kalau app.club_id belum disetel. Tapi GET/POST /join/{token}
-- (PLAN.md §6.4) justru dipanggil SEBELUM klub-nya diketahui: itulah
-- gunanya token, menemukan club_id. Ayam-telur ini diselesaikan lewat satu
-- fungsi SECURITY DEFINER bercakupan sempit (cuma club_id, cuma token
-- aktif+belum kedaluwarsa) yang dimiliki kok_migrate (BYPASSRLS) — bukan
-- dengan melonggarkan RLS club_links itu sendiri.
-- +goose StatementBegin
CREATE FUNCTION club_id_for_join_token(p_token text) RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE sql STABLE AS $$
  SELECT club_id FROM club_links
  WHERE token = p_token AND active AND (expires_at IS NULL OR expires_at > now());
$$;
-- +goose StatementEnd

GRANT EXECUTE ON FUNCTION club_id_for_join_token(text) TO kok_app;

-- +goose Down
DROP FUNCTION club_id_for_join_token(text);
