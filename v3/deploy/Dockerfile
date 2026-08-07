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

# ---- stage 3: image final, tanpa toolchain sama sekali ---------------------
FROM gcr.io/distroless/static-debian12:nonroot AS final
COPY --from=server-build /out/api /usr/local/bin/api
COPY --from=server-build /out/seed /usr/local/bin/seed
USER nonroot:nonroot
EXPOSE 8300
ENTRYPOINT ["/usr/local/bin/api"]
