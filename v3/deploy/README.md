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
Cakupan pass ini: pemain, jenis kok, main harian, pengeluaran, carry→
dompet awal. **Turnamen belum termasuk** — jangan cutover sungguhan
sebelum itu menyusul dan diuji seketat bagian ini (lihat komentar
`server/internal/migratev2/migrate.go`).

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
