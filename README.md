# Kok Badminton

Pencatatan kok badminton — 2 pair, multi-kok, harga snapshot, bayar/belum.

## Live
https://kok.ryanprayoga.dev

## Stack
- Express + Postgres (`DATABASE_URL` env, wajib)
- Static UI di `public/`
- PM2 name: `kok-badminton`
- Port VPS: `127.0.0.1:8200`
- Caddy: `/etc/caddy/sites/kok-badminton.caddy`

## Local run
```bash
npm install
echo "DATABASE_URL=postgresql://user:pass@localhost:5432/kok_badminton" > .env
npm start
# open http://127.0.0.1:8200
```
Butuh Postgres jalan (lokal atau tunnel ke VPS) dengan tabel `settings`, `players`, `games` — lihat skema di commit migrasi Postgres. Server auto-import `data/db.json` lama sekali doang, kalau tabel `games` masih kosong pas boot.

## Fitur
- 4 pemain = Pair A vs Pair B
- Skor per pair
- Multi-kok, harga per-kok di-snapshot (ganti default tidak ubah history)
- Toggle bayar per orang + ringkasan hutang

## Akses
- `/` — publik, read-only: riwayat + belum bayar.
- `/admin` — lockscreen PIN 6 digit, CRUD penuh.
- PIN admin auto-generate saat server pertama kali jalan, tersimpan di `data/admin-pin.txt` (gitignored). Cek lewat log server (`pm2 logs kok-badminton`) atau override via env `ADMIN_PIN`.
