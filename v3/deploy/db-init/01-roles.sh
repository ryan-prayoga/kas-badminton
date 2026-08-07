#!/bin/bash
# Bootstrap role aplikasi untuk dev/CI (PLAN.md §6.2, DDL.sql baris 31-38).
#
# Jalan SEKALI oleh image resmi postgres saat volume data masih kosong
# (docker-entrypoint-initdb.d), sebagai role container ($POSTGRES_USER —
# kok_owner, bukan kok_app: nama itu dipakai role tunduk-RLS di bawah, jadi
# TIDAK BOLEH jadi superuser/pemilik DB, atau RLS terlewati diam-diam).
#
# Migrasi goose 00002_roles.sql mengulang CREATE ROLE ini secara idempoten
# (NOLOGIN) — no-op di sini karena sudah ada duluan lewat skrip ini.
set -euo pipefail

: "${KOK_MIGRATE_PASSWORD:?KOK_MIGRATE_PASSWORD wajib diisi}"
: "${KOK_APP_PASSWORD:?KOK_APP_PASSWORD wajib diisi}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_migrate') THEN
      CREATE ROLE kok_migrate LOGIN PASSWORD '${KOK_MIGRATE_PASSWORD}' BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kok_app') THEN
      CREATE ROLE kok_app LOGIN PASSWORD '${KOK_APP_PASSWORD}';
    END IF;
  END \$\$;

  -- kok_migrate jadi pemilik DB supaya bisa CREATE TABLE/TYPE/POLICY tanpa
  -- superuser (§6.2 "migrasi goose memakai role terpisah yang boleh
  -- melewati RLS"). kok_app cuma dapat GRANT eksplisit lewat migrasi RLS
  -- (00016_rls.sql) — tidak pernah jadi pemilik apa pun.
  ALTER DATABASE ${POSTGRES_DB} OWNER TO kok_migrate;
EOSQL
