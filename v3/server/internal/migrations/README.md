# Migrasi (goose)

Migrasi skema dikelola [goose](https://github.com/pressly/goose), format
SQL, di-`embed` ke binary lewat `go:embed` (`migrations.go`) — dipakai
`cmd/migrate` (satu binary, tanpa CLI eksternal di produksi, PLAN.md §4.1).

```bash
# jalankan migrasi lewat binary (cara resmi, dipakai jugadi docker-compose
# service "migrate" dan CI)
MIGRATE_DATABASE_URL=postgresql://kok_migrate:...@localhost:5434/kok_v3 \
  go run ./cmd/migrate

# scaffolding file migrasi baru (goose CLI, cuma dev-time — sudah jadi
# `tool` dependency di go.mod sejak F0, tak perlu instal terpisah)
go tool goose -dir internal/migrations create nama_migrasi sql
```

Isi (`DDL.sql` di root `v3/` adalah gambar utuhnya, dipecah di sini
mengikuti section-nya sendiri, F2 — PLAN.md §14):

| # | Isi |
|---|---|
| 00001 | Ekstensi Postgres (`pgcrypto`, `citext`, `pg_trgm`) |
| 00002 | Role `kok_app` / `kok_migrate` (idempoten — lihat catatan di bawah) |
| 00003 | Enum |
| 00004 | `clubs` |
| 00005 | `users`, `user_aliases`, `memberships`, `platform_admins` |
| 00006 | `sessions`, `webauthn_credentials`, `user_pins`, `otp_codes` |
| 00007 | `club_links`, `invites`, `claim_requests` |
| 00008 | `idempotency_keys` |
| 00009 | `kok_types`, `expenses` |
| 00010 | `games`, `game_players`, `game_scores`, `game_koks` |
| 00011 | `tournaments`, `tournament_pairs`, `matches`, `match_games`, `match_koks`, `match_kok_charges`, `tournament_fees` |
| 00012 | `payments`, `payment_allocations`, `wallet_entries` + trigger saldo tidak minus |
| 00013 | `side_bets` |
| 00014 | `push_subscriptions`, `notification_prefs`, `notifications`, `media` |
| 00015 | `audit_log` |
| 00016 | Row-Level Security: `current_club()`, policy per tabel, grant |
| 00017 | `club_id_for_join_token()` — resolusi token publik `/join/{token}` sebelum club_id diketahui (F4/3, SECURITY DEFINER sempit, bukan pelonggaran RLS) |
| 00018 | `club_id_for_invite_token()` — sama alasannya, buat token undangan per-orang (`invites`) |
| 00019 | `club_member_count()` — jumlah anggota per klub buat GET /admin/clubs (F4/5), SECURITY DEFINER sempit (cuma count, bukan baris) supaya tetap sesuai §6.5 |
| 00020 | `wa_outbox`, `wa_worker_heartbeat` — titipan pesan WA dari cmd/api ke cmd/waworker (F4/6, §12 "Bridge WA satu proses"); BUKAN tabel `notifications` F8, lihat komentar di berkas migrasinya |

Jalankan migrasi sebagai role `kok_migrate` (BYPASSRLS), aplikasi jalan
sebagai `kok_app` — kalau aplikasi memakai pemilik tabel, RLS terlewati
diam-diam. Role-nya sendiri **NOLOGIN** di migrasi 00002 (sengaja
idempoten): di dev/CI, `deploy/db-init/01-roles.sh` sudah membuatnya
LOGIN+password lebih dulu (jalan sekali saat container Postgres
diinisialisasi, sebelum migrasi apa pun), jadi 00002 no-op di situ. Di
produksi, ops yang membuat role + kredensial di luar version control;
00002 jadi jaring pengaman kalau belum ada.
