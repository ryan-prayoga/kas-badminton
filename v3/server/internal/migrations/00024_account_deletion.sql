-- +goose Up
-- Hapus akun sendiri (PLAN.md §12 "Hapus akun & ekspor data pribadi",
-- §12.2, F9/4): transaksi keuangan TIDAK dihapus, identitas dianonimkan
-- jadi "Pemain terhapus" — phone & username dilepas, status pindah ke
-- 'disabled' (sudah ada di enum user_status sejak 00003, belum pernah
-- dipakai kode — dipilih di sini KARENA belum dipakai, bukan menimpa
-- makna lain).
--
-- users_claimed_has_phone (00005_identity.sql) semula cuma mengizinkan
-- phone IS NULL kalau status='unclaimed'. 'disabled' SENGAJA dipisah dari
-- 'unclaimed', bukan dipakai ulang: SearchUnclaimedByClub (users.sql)
-- memfilter status='unclaimed' persis supaya akun bayangan (belum pernah
-- ada orangnya) bisa diklaim siapa saja — akun yang SUDAH dihapus
-- pemiliknya sendiri tidak boleh muncul di daftar itu dan diklaim ulang
-- orang lain (itu akan membuat riwayat uang "Pemain terhapus" menempel ke
-- akun baru yang tidak ada hubungannya). Constraint yang lama menolak
-- kombinasi disabled+phone-NULL, jadi harus dilonggarkan eksplisit di sini.
ALTER TABLE users DROP CONSTRAINT users_claimed_has_phone;
ALTER TABLE users ADD CONSTRAINT users_claimed_has_phone
  CHECK (
    (status IN ('unclaimed', 'disabled') AND phone IS NULL)
    OR (status NOT IN ('unclaimed', 'disabled') AND phone IS NOT NULL)
  );

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_claimed_has_phone;
ALTER TABLE users ADD CONSTRAINT users_claimed_has_phone
  CHECK ((status = 'unclaimed' AND phone IS NULL) OR (status <> 'unclaimed' AND phone IS NOT NULL));
