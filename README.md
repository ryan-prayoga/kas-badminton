# Kok Badminton

Pencatatan kok badminton — 2 pair, multi-kok, harga snapshot, bayar/belum.

## Live
https://kok.ryanprayoga.dev

## Stack
- Express + JSON store (`data/db.json`)
- Static UI di `public/`
- PM2 name: `kok-badminton`
- Port VPS: `127.0.0.1:8200`
- Caddy: `/etc/caddy/sites/kok-badminton.caddy`

## Local run
```bash
npm install
npm start
# open http://127.0.0.1:8200
```

## Fitur
- 4 pemain = Pair A vs Pair B
- Skor per pair
- Multi-kok, harga per-kok di-snapshot (ganti default tidak ubah history)
- Toggle bayar per orang + ringkasan hutang
