-- +goose Up
-- memberships ber-RLS (00016) — GET /admin/clubs (§7 API.md, §6.5) perlu
-- JUMLAH anggota per klub buat metrik agregat, TANPA membaca isi klub
-- (superadmin tidak boleh, §6.5). Query lintas-klub biasa (tanpa
-- app.club_id) akan melihat NOL baris di semua klub, bukan hitungan
-- sungguhan — sama masalahnya dengan 00017/00018. Fungsi ini SENGAJA
-- cuma mengembalikan count(*), tidak pernah baris memberships itu sendiri,
-- supaya tetap sesuai batas §6.5 walau bypass RLS.
-- +goose StatementBegin
CREATE FUNCTION club_member_count(p_club_id uuid) RETURNS bigint
SECURITY DEFINER
SET search_path = public
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM memberships WHERE club_id = p_club_id AND left_at IS NULL;
$$;
-- +goose StatementEnd

GRANT EXECUTE ON FUNCTION club_member_count(uuid) TO kok_app;

-- +goose Down
DROP FUNCTION club_member_count(uuid);
