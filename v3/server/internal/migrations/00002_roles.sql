-- +goose Up
-- Role aplikasi (PLAN.md §6.2, DDL.sql baris 31-38). Aplikasi TIDAK BOLEH
-- memakai pemilik tabel: pemilik melewati RLS diam-diam dan itu menghapus
-- seluruh manfaat lapisan ketiga.
--
-- Dibuat NOLOGIN + idempoten di sini dengan sengaja: di dev/CI, role ini
-- sudah ada lebih dulu (LOGIN + password) lewat bootstrap
-- deploy/db-init/01-roles.sh yang jalan sebelum migrasi apa pun — jadi
-- blok ini no-op di situ. Di produksi, ops yang membuat role + password di
-- luar version control; migrasi ini jadi jaring pengaman kalau belum ada.
-- +goose StatementBegin
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_app') THEN
    CREATE ROLE kok_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_migrate') THEN
    CREATE ROLE kok_migrate NOLOGIN BYPASSRLS;
  END IF;
END $$;
-- +goose StatementEnd

-- +goose Down
-- Sengaja tidak DROP ROLE: kok_migrate biasanya jadi pemilik database
-- (lihat deploy/db-init/01-roles.sh), dan kredensial LOGIN-nya (kalau ada)
-- diberi lewat jalur di luar migrasi ini. Menghapusnya di sini bisa
-- mematahkan koneksi yang sedang dipakai proses lain.
SELECT 1;
