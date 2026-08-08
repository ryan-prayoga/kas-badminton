#!/usr/bin/env bash
# Uji pemulihan (PLAN.md §12 "restore diuji berkala, karena cadangan yang
# tak pernah diuji bukan cadangan" — §14 F9/2). SATU-SATUNYA jaring
# pengaman cutover (§10 F10 "tidak ada jalur pulang").
#
# Restore ke instans Postgres SEKALI PAKAI, TERPISAH TOTAL dari `db` yang
# sedang produksi (kontainer + volume baru, dibuang habis di akhir lewat
# trap) — skrip ini TIDAK PERNAH menyentuh data yang sedang jalan. Kalau
# restore gagal, itu cuma berarti instans sekali-pakai ini yang rusak.
#
# Dipanggil tanpa argumen: pakai dump lokal terbaru di deploy/backups/.
# Dipanggil dengan argumen: path dump spesifik (mis. dari cadangan
# off-site yang diunduh ulang, buat membuktikan file offsite-nya juga
# sungguhan bisa dipulihkan, bukan cuma yang lokal).
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$COMPOSE_DIR/backups}"
MIGRATIONS_DIR="$COMPOSE_DIR/../server/internal/migrations"

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(ls -t "$BACKUP_DIR"/kok_v3_*.dump 2>/dev/null | head -1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "[restore-test] tidak ada dump ditemukan (cek \$1 atau isi $BACKUP_DIR)" >&2
  exit 1
fi
echo "[restore-test] menguji: $DUMP"

CONTAINER="kok_v3_restore_test_$$"
NETWORK_ARGS=()

cleanup() {
  echo "[restore-test] membersihkan kontainer sekali-pakai..."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[restore-test] menyalakan Postgres sekali-pakai..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=restore_test_only \
  -e POSTGRES_DB=kok_v3 \
  "${NETWORK_ARGS[@]}" \
  postgres:16 >/dev/null

echo "[restore-test] menunggu siap..."
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d kok_v3 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$CONTAINER" pg_isready -U postgres -d kok_v3 >/dev/null 2>&1; then
  echo "[restore-test] GAGAL: Postgres sekali-pakai tidak pernah siap" >&2
  exit 1
fi

echo "[restore-test] menjalankan pg_restore..."
docker cp "$DUMP" "$CONTAINER:/tmp/restore.dump"
if ! docker exec "$CONTAINER" pg_restore -U postgres -d kok_v3 --no-owner --no-privileges /tmp/restore.dump; then
  # pg_restore SERING balik exit code bukan-nol buat warning yang tidak
  # fatal (mis. objek yang butuh peran sumber yang tidak ada di sini,
  # -Fc dump dari DDL.sql sengaja punya banyak GRANT ke role produksi).
  # Yang menentukan LULUS/GAGAL di sini adalah query sanity di bawah, bukan
  # exit code pg_restore sendirian — dicatat sebagai peringatan saja.
  echo "[restore-test] pg_restore keluar dgn peringatan (biasa buat GRANT role produksi) — lanjut ke sanity check"
fi

echo "[restore-test] sanity check..."
fail=0
check() {
  local label="$1" sql="$2" want_min="$3"
  local got
  got="$(docker exec "$CONTAINER" psql -U postgres -d kok_v3 -tAc "$sql" | tr -d '[:space:]')"
  if [ -z "$got" ] || [ "$got" -lt "$want_min" ] 2>/dev/null; then
    echo "  [FAIL] $label = '$got' (mau >= $want_min)"
    fail=1
  else
    echo "  [OK]   $label = $got"
  fi
}

# Tabel inti WAJIB ada strukturnya (count 0 baris tetap OK buat DB baru —
# yang tidak boleh adalah QUERY-nya sendiri gagal karena tabel/kolom
# hilang, itu sinyal dump-nya rusak/tidak lengkap).
check "tabel clubs bisa di-query"       "SELECT COUNT(*) FROM clubs"       0
check "tabel users bisa di-query"       "SELECT COUNT(*) FROM users"       0
check "tabel memberships bisa di-query" "SELECT COUNT(*) FROM memberships" 0
check "tabel games bisa di-query"       "SELECT COUNT(*) FROM game_players" 0
check "tabel payments bisa di-query"    "SELECT COUNT(*) FROM payments"    0

# Versi migrasi goose di dump harus sudah sampai migrasi TERBARU di repo
# ini — restore ke skema yang KETINGGALAN tanpa ketahuan lebih berbahaya
# daripada restore gagal total (silent data loss di kolom yang belum ada).
expected_version="$(ls "$MIGRATIONS_DIR"/[0-9]*.sql 2>/dev/null | sed -E 's/.*\/([0-9]+)_.*/\1/' | sort -n | tail -1 | sed 's/^0*//')"
if [ -n "$expected_version" ]; then
  check "versi migrasi goose (mau >= ${expected_version})" \
    "SELECT COALESCE(MAX(version_id),0) FROM goose_db_version" "$expected_version"
fi

if [ "$fail" -ne 0 ]; then
  echo "[restore-test] GAGAL — lihat [FAIL] di atas" >&2
  exit 1
fi
echo "[restore-test] LULUS — dump ini terbukti bisa dipulihkan dan skemanya lengkap"
