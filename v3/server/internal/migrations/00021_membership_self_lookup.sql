-- +goose Up
-- Longgarin RLS memberships (00016) supaya GET /me (API.md §1) bisa
-- membaca "klub apa saja yang saya ikuti" LINTAS klub tanpa app.club_id
-- diset — kebutuhan nyata sejak F5 (Beranda perlu tau klub aktif; kalau
-- app dibuka di HP baru / storage lokal kehapus, satu-satunya sumber
-- kebenaran adalah baris memberships milik user itu sendiri, bukan cache
-- klien).
--
-- Pendekatan: session var BARU app.user_id (paralel app.club_id yang
-- sudah ada — lihat internal/store/tenant.go WithUser), lalu policy
-- memberships dipecah dua:
--   - memberships_tenant_write (FOR ALL): TETAP wajib club_id =
--     current_club() untuk INSERT/UPDATE/DELETE **dan** jadi lantai buat
--     SELECT juga (permissive policies di-OR, lihat di bawah) — tidak
--     berubah dari perilaku lama.
--   - memberships_tenant_read (FOR SELECT saja): tambahan jalur baca —
--     user_id = current_user_id(). Karena policy permissive di-OR
--     (Postgres RLS), efeknya SELECT jadi (club_id=current_club() OR
--     user_id=current_user_id()), sementara INSERT/UPDATE/DELETE tidak
--     kena policy FOR SELECT ini sama sekali — tetap murni club_id.
-- Hasilnya: user boleh lihat baris memberships MILIKNYA SENDIRI di klub
-- mana pun (buat GET /me), tapi TIDAK BISA lihat baris milik orang lain
-- di klub yang bukan dia anggota, dan TIDAK BISA menulis (join/leave/ubah
-- peran) tanpa app.club_id yang benar seperti sebelumnya.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
-- +goose StatementEnd

DROP POLICY memberships_tenant ON memberships;

CREATE POLICY memberships_tenant_write ON memberships
  FOR ALL
  USING (club_id = current_club())
  WITH CHECK (club_id = current_club());

CREATE POLICY memberships_tenant_read ON memberships
  FOR SELECT
  USING (club_id = current_club() OR user_id = current_user_id());

-- +goose Down
DROP POLICY memberships_tenant_read ON memberships;
DROP POLICY memberships_tenant_write ON memberships;

CREATE POLICY memberships_tenant ON memberships
  USING (club_id = current_club())
  WITH CHECK (club_id = current_club());

DROP FUNCTION current_user_id();
