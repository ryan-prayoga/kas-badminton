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
- Multi-kok, harga per-kok di-snapshot (ganti default tidak ubah history)
- Katalog jenis kok (nama + harga default + stok) di admin — pilih saat catat main
- Stok otomatis berkurang saat dipakai di game, kembali saat kok/game dihapus. Stok 0 diblokir (client + server)
- Toggle bayar per orang + ringkasan hutang
- Navigasi bottom navbar (Riwayat · Belum bayar · Statistik [· Lainnya di admin])
- Cicilan / bayar sebagian per orang (ledger `payments` + `player_carry`, greedy auto-settle game terlama dulu)
- Lunasin semua tagihan per orang sekali klik
- Share/copy rekap tagihan ke WhatsApp
- Statistik pemain (total main, keluar, nunggak)
- Bayar QRIS: QRIS statis merchant → dynamic QRIS per nominal (via `@prasetya/qris`, nominal bebas termasuk cicilan)

## QRIS
Set QRIS statis merchant di **admin → Lainnya → Pengaturan & QRIS** (tempel payload string, decode dari QR cetak). Sekali diset, tombol "Bayar QRIS" muncul di kartu tagihan (publik + admin) → generate QR dinamis dengan nominal (sisa penuh atau cicilan). Pembayaran QRIS langsung ke merchant — app tidak dapat notif otomatis, jadi admin catat cicilan/lunas manual setelah dana masuk.

## Akses
- `/` — publik, read-only: riwayat + belum bayar.
- `/admin` — lockscreen PIN 6 digit, CRUD penuh.
- PIN admin auto-generate saat server pertama kali jalan, tersimpan di `data/admin-pin.txt` (gitignored). Cek lewat log server (`pm2 logs kok-badminton`) atau override via env `ADMIN_PIN`.
