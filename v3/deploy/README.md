# Operasional — backup, restore, migrasi v2 → v3 (F9/2, F10)

PLAN.md §12: "Backup terjadwal + uji pemulihan. Bukan cuma dijadwalkan —
restore diuji berkala, karena cadangan yang tak pernah diuji bukan
cadangan. Ini juga satu-satunya jaring pengaman cutover, mengingat tidak
ada jalur pulang."

## Cara pakai

```bash
# Backup manual, sekali jalan (butuh service `db` docker-compose lagi jalan)
./backup.sh

# Uji restore dump TERBARU ke instans Postgres sekali-pakai (dibuang
# otomatis di akhir, TIDAK PERNAH menyentuh `db` yang produksi)
./restore-test.sh

# Uji restore dump SPESIFIK (mis. yang baru diunduh ulang dari off-site)
./restore-test.sh /path/ke/kok_v3_20260101T000000Z.dump
```

`restore-test.sh` keluar exit code bukan-nol kalau gagal — cocok
dipasang di CI/cron dengan alert (mis. `|| curl healthchecks.io/fail`).

## Jadwal produksi (systemd timer)

Dua unit per skrip, contoh `/etc/systemd/system/kok-v3-backup.service`:

```ini
[Unit]
Description=Kok Badminton v3 — backup DB

[Service]
Type=oneshot
WorkingDirectory=/opt/kok-badminton/v3/deploy
ExecStart=/opt/kok-badminton/v3/deploy/backup.sh
User=deploy
```

`/etc/systemd/system/kok-v3-backup.timer`:

```ini
[Unit]
Description=Jadwal backup Kok Badminton v3 — tiap hari 02:00 WIB

[Timer]
OnCalendar=*-*-* 19:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

Sama untuk `kok-v3-restore-test.{service,timer}` (`ExecStart=.../restore-test.sh`),
dijadwalkan **mingguan**, beberapa jam SETELAH backup harian (misal Minggu
20:00 UTC) — supaya selalu menguji dump yang baru, bukan basi.

Aktifkan:

```bash
systemctl enable --now kok-v3-backup.timer kok-v3-restore-test.timer
```

## Retensi & off-site

`backup.sh` cuma menjaga retensi **lokal** (`RETAIN_DAYS`, bawaan 14
hari) di `deploy/backups/`. Salinan **off-site** (S3, rsync ke mesin
lain, dst) sengaja dipasang terpisah (`rclone sync deploy/backups/
remote:kok-v3-backups` lewat cron/timer sendiri) — satu skrip, satu
tanggung jawab, supaya kalau salah satu jalur berhenti bekerja
kelihatan jelas jalur mana yang bermasalah.

## Sebelum cutover (F10)

§10 F10: "latihan migrasi berulang di salinan produksi sampai nol
selisih; cadangan DB tepat sebelum cutover yang **sudah diuji restore**".
Jalankan `restore-test.sh` manual tepat sebelum cutover, bukan
mengandalkan jadwal mingguan kebetulan baru jalan.

## Migrasi v2 → v3 (F10, `cmd/migrate-v2`)

v2 TIDAK PERNAH ditulis — `migrate-v2` cuma SELECT read-only ke DB v2.
Cakupan: pemain, jenis kok, main harian, pengeluaran, carry→dompet awal,
DAN turnamen (bagan/klasemen, skor, kok per-partai & umum, iuran) —
bagan turnamen dihitung ulang lewat `internal/domain` (port 1:1 dari
`lib/domain/tournament.ts` v2), bukan diimplementasikan ulang di
`migratev2`.

```bash
# 1. Deteksi nama yang mungkin sama orang + tulis berkas pemetaan awal.
#    Berkas ini berisi NAMA ANGGOTA SUNGGUHAN — jangan commit ke repo
#    publik, taruh di ops/deploy operator (sama semangat .env).
docker compose --profile tools run --rm migrate-v2 \
  dedupe --v2-dsn=postgresql://user@host/kok_v2 --write-template /data/mapping.json

# 2. EDIT MANUAL berkas mapping.json — samakan value buat nama yang
#    memang orang yang sama, biarkan apa adanya kalau kebetulan mirip
#    tapi beda orang. Ini keputusan MANUSIA, bukan langkah otomatis.

# 3. Migrasi sungguhan — idempoten, aman diulang kalau gagal di tengah
#    (verifikasi gagal = seluruh transaksi dibatalkan, tidak ada data
#    setengah-jadi yang tertinggal).
docker compose --profile tools run --rm migrate-v2 \
  run --v2-dsn=postgresql://user@host/kok_v2 \
      --slug=pb-nama-klub --name="PB Nama Klub" \
      --mapping=/data/mapping.json --admin="Nama Admin"
```

`--v3-dsn` default ke `$DATABASE_URL` (sudah diisi service `migrate-v2`
di docker-compose.yml, mengarah ke `db` role `kok_app`). `--admin` SANGAT
disarankan diisi — klub tanpa admin tidak ada yang bisa menyetujui
claim-request siapa pun (§7.3).

**Latihan berulang sebelum cutover sungguhan** (§10 F10 "tidak ada jalur
pulang"): jalankan ke salinan v3 yang boleh dibuang, bandingkan angka,
ulangi sampai nol selisih — `migrate-v2 run` idempoten jadi aman diulang
persis, tidak perlu bersih-bersih manual di antara percobaan.

## Sync HIDUP v2 ↔ v3 (`cmd/sync-v2`) — jalan bareng, bukan freeze

Beda dari `migrate-v2` di atas (sekali jalan, buat cutover): **v2 dan v3
boleh jalan BERSAMAAN** selama Ryan belum bilang pindah total. v2 tetap
SATU-SATUNYA tempat input buat domain klasik (main harian, pembayaran,
pengeluaran, stok kok, pemain, turnamen) — `sync-v2` cuma proses latar
yang menjaga v3 tetap cermin HIDUP dari v2, jalan tiap `--interval`
(bawaan 60 detik). Fitur v3-only (dompet/deposit, main jumlah pemain
bebas, taruhan barang, alokasi bayar sebagian) TIDAK disentuh proses ini
— tidak ada representasinya di skema v2, jadi bebas dipakai di v3 tanpa
pernah bentrok.

**Prasyarat**: klub sudah pernah dimigrasi (`migrate-v2 run`, bagian di
atas) — atau biarkan `sync-v2` yang membuatnya di putaran pertama kalau
belum ada (dia pakai `--slug`/`--name`/`--admin` yang sama). Berkas
pemetaan nama (`mapping.json`) tetap wajib, dan **boleh diedit sambil
proses jalan** — `sync-v2` muat ulang tiap putaran, jadi nama baru/typo
yang ke-skip satu putaran bisa langsung tertangkap putaran berikutnya
tanpa restart.

```bash
# 1. .env: isi minimal ini (di luar yang sudah ada buat db/api)
#    SYNC_V2_DATABASE_URL=postgresql://<role-readonly>@<host-v2>:5432/kok_badminton
#    SYNC_V2_CLUB_SLUG=pb-nama-klub
#    SYNC_V2_CLUB_NAME=PB Nama Klub
#    SYNC_V2_ADMIN=Nama Admin

# 2. mapping.json (sama berkas hasil `migrate-v2 dedupe`) taruh di
#    v3/deploy/mapping.json — di-mount read-only ke container.

# 3. Nyalakan (opt-in lewat --profile, TIDAK ikut naik di `docker compose
#    up` biasa — supaya lupa isi env di atas tidak pernah menjatuhkan
#    db/api juga):
docker compose --profile sync-v2 up -d sync-v2

# Log tiap putaran (jumlah tersync, nama yang di-skip, dst):
docker compose logs -f sync-v2

# Matikan begitu cutover sungguhan diputuskan — v2 dibekukan read-only,
# sync-v2 tidak perlu jalan lagi:
docker compose stop sync-v2
```

**Role Postgres read-only di sisi v2** (disarankan, tidak wajib — sync
cuma pernah `SELECT`, lihat komentar package `internal/migratev2`):

```sql
-- Dijalankan di DB v2 (kok_badminton), sekali:
CREATE ROLE kok_sync_readonly LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE kok_badminton TO kok_sync_readonly;
GRANT USAGE ON SCHEMA public TO kok_sync_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kok_sync_readonly;
```

**Batasan yang diketahui** (bukan bug diam-diam — lihat komentar package
`internal/migratev2/sync.go`):

- Kesegaran dibatasi interval polling, bukan real-time detik. Kalau
  perlu lebih cepat, `v2/lib/realtime.ts` sudah punya sinyal
  `publish("update")` tiap mutasi — bisa dipakai trigger sync langsung
  di iterasi berikutnya, belum dikerjakan di v1 ini.
- Status lunas iuran & kok per-partai TURNAMEN (beda dari main harian,
  yang sudah tertangkap) belum ikut disinkronkan ulang kalau diedit
  setelah tersync pertama kali — cakupan v1 fokus ke main harian, domain
  paling sering berubah setelah tercatat.
- Carry v2 yang TURUN (koreksi manual) tidak ditarik otomatis dari
  dompet v3 (ledger append-only, §9.1 tidak boleh minus) — dilaporkan di
  log (`carry v2 turun`), butuh tindakan manual (penyesuaian dompet lewat
  UI admin).
