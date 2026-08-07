# Kok Badminton v3 — dev

Rencana lengkap: [`PLAN.md`](PLAN.md). Skema: [`DDL.sql`](DDL.sql). Status:
**F0 selesai** — fondasi, belum ada fitur (lihat PLAN.md §14).

## Jalan lewat Docker (cara paling deket ke prod)

```bash
cd v3
docker compose -f deploy/docker-compose.yml up --build
# api:  http://127.0.0.1:8300  (healthz di /healthz)
# db:   127.0.0.1:5434 (postgres, dev only)
```

Satu binary, SPA SvelteKit ter-embed di dalamnya lewat `go:embed` — tidak
ada Node yang jalan saat runtime (PLAN.md §4.1).

## Jalan tanpa Docker (dev harian, hot reload)

Dua proses terpisah:

```bash
# terminal 1 — Postgres lokal, database kok_v3 terpisah dari v2
createdb kok_v3   # atau docker run postgres:16 manual

# terminal 2 — API Go (serve placeholder statis, bukan SPA sungguhan)
cd v3/server
DATABASE_URL=postgresql://127.0.0.1/kok_v3 go run ./cmd/api

# terminal 3 — SvelteKit dev server, hot reload
cd v3/web
npm install
npm run dev
```

Frontend dev server (`npm run dev`) tidak lewat Go — panggil API langsung ke
`:8300`. Endpoint API belum ada di F0 selain `/healthz`; F2 menambah yang lain.

## Migrasi (goose)

```bash
cd v3/server
go tool goose -dir migrations postgres "$DATABASE_URL" up
```

Baru ada satu migrasi (`00001_extensions.sql`). Skema penuh dipecah jadi
migrasi berurutan di F2 — lihat [`migrations/README.md`](server/migrations/README.md).

## Test / lint / vet

```bash
cd v3/server && gofmt -l . && go vet ./... && go test ./...
cd v3/web    && npm run check
```

CI: [`.github/workflows/ci-v3.yml`](../.github/workflows/ci-v3.yml) —
jalan di tiap push/PR yang menyentuh `v3/**`. Beda dari CI v2/v1 yang cuma
build+deploy, ini yang benar-benar menjalankan test.

## Aturan yang wajib dijaga

- **Jangan sentuh `v2/`** — masih produksi sampai cutover (PLAN.md §0).
- **Uang selalu `int64` rupiah**, tidak pernah `float` (invarian §3).
- Belum ada notifikasi sungguhan — `internal/notify.Fake` cuma nulis ke log.
  Jangan pasang nomor WA produksi buat dev.
