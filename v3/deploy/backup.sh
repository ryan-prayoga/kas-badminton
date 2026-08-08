#!/usr/bin/env bash
# Backup terjadwal (PLAN.md §12 "Backup terjadwal + uji pemulihan", F9/2).
#
# Dump format kustom pg_dump (-Fc) lewat container `db` yang sudah jalan
# (docker-compose.yml) — TIDAK perlu client Postgres terpasang di host,
# cukup docker. Ditaruh sebagai systemd timer atau cron di VPS produksi
# (lihat deploy/README.md buat contoh unit-nya).
#
# Dump kustom (-Fc), BUKAN plain SQL: bisa direstore parsial (--table),
# terkompresi otomatis, dan itu yang dibaca pg_restore di restore-test.sh
# — dua skrip ini sengaja sepasang, jangan ganti format salah satu tanpa
# mengubah yang lain.
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$COMPOSE_DIR/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_NAME="${POSTGRES_DB:-kok_v3}"
DB_USER="${POSTGRES_OWNER_USER:-kok_owner}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/kok_v3_${stamp}.dump"
tmp="${out}.tmp"

echo "[backup] dumping ${DB_NAME} dari service ${DB_SERVICE} -> ${out}"

# pg_dump dijalankan DI DALAM container (docker compose exec -T, tanpa
# tty) supaya hasilnya bisa disalurkan langsung ke stdout host — file
# dump tidak pernah numpuk di dalam container yang bisa didaur ulang.
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T "$DB_SERVICE" \
  pg_dump -U "$DB_USER" -Fc -d "$DB_NAME" > "$tmp"

# Tulis ke berkas sementara dulu, baru rename atomik — kalau pg_dump
# gagal di tengah jalan (disk penuh, koneksi putus), tidak ada dump
# SETENGAH JADI yang kelihatan seperti backup valid oleh skrip lain.
mv "$tmp" "$out"
echo "[backup] selesai: $(du -h "$out" | cut -f1)"

# Retensi lokal — cadangan off-site (S3/rsync ke server lain) bukan
# tanggung jawab skrip ini, dipasang terpisah di level ops (rclone/cron
# lain) supaya satu skrip tetap satu tanggung jawab.
find "$BACKUP_DIR" -name 'kok_v3_*.dump' -mtime "+${RETAIN_DAYS}" -print -delete
echo "[backup] retensi lokal: ${RETAIN_DAYS} hari"
