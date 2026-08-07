# Migrasi (goose)

Migrasi skema dikelola [goose](https://github.com/pressly/goose), format SQL.

```bash
# instal sekali (CLI, bukan dependency go.mod)
go install github.com/pressly/goose/v3/cmd/goose@latest

# jalanin migrasi
goose -dir migrations postgres "$DATABASE_URL" up

# migrasi baru
goose -dir migrations create nama_migrasi sql
```

`00001_extensions.sql` cuma ekstensi Postgres yang dipakai seluruh skema.
Skema penuh (35 tabel, 89 indeks, RLS, trigger — lihat
[`v3/DDL.sql`](../DDL.sql)) dipecah jadi migrasi berurutan berikutnya di F2
(PLAN.md §14) — jangan dijalankan sebagai satu migrasi raksasa.

Jalankan migrasi sebagai role `kok_migrate`, aplikasi jalan sebagai
`kok_app` — kalau aplikasi memakai pemilik tabel, RLS terlewati diam-diam.
