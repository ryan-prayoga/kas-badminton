# syntax=docker/dockerfile:1

# ---- stage 1: build web (SvelteKit -> SPA statis) -------------------------
FROM node:20-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- stage 2: build binary Go, dengan SPA di-embed -------------------------
FROM golang:1.25-bookworm AS server-build
WORKDIR /server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# Timpa placeholder dengan hasil build Svelte sungguhan sebelum go:embed
# membaca isinya (lihat internal/webassets/webassets.go).
RUN rm -rf internal/webassets/dist
COPY --from=web-build /web/build ./internal/webassets/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate-v2 ./cmd/migrate-v2
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/sync-v2 ./cmd/sync-v2

# ---- stage 3: image final, tanpa toolchain sama sekali ---------------------
FROM gcr.io/distroless/static-debian12:nonroot AS final
COPY --from=server-build /out/api /usr/local/bin/api
COPY --from=server-build /out/seed /usr/local/bin/seed
COPY --from=server-build /out/migrate /usr/local/bin/migrate
USER nonroot:nonroot
EXPOSE 8300
ENTRYPOINT ["/usr/local/bin/api"]

# ---- stage 4: khusus buat `docker compose run migrate` --------------------
# Target terpisah biar compose gak perlu ENTRYPOINT override tiap panggil.
FROM gcr.io/distroless/static-debian12:nonroot AS migrate
COPY --from=server-build /out/migrate /usr/local/bin/migrate
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/migrate"]

# ---- stage 5: khusus buat `docker compose run migrate-v2` (F10, sekali
# pakai saat cutover — bukan bagian image yang jalan terus) ------------------
FROM gcr.io/distroless/static-debian12:nonroot AS migrate-v2
COPY --from=server-build /out/migrate-v2 /usr/local/bin/migrate-v2
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/migrate-v2"]

# ---- stage 6: cmd/sync-v2 — BEDA dari migrate-v2 di atas, ini proses
# PERSISTEN (docker-compose.yml service `sync-v2`, restart: unless-stopped),
# bukan `--profile tools` sekali jalan — v2 & v3 jalan bersamaan sampai
# Ryan bilang pindah (PLAN.md §14 F10 "sync hidup"). --------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS sync-v2
COPY --from=server-build /out/sync-v2 /usr/local/bin/sync-v2
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/sync-v2"]
