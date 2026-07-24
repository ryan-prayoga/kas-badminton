# syntax=docker/dockerfile:1

# ---- deps (build-time, full incl. devDeps buat next/typescript/tailwind) ----
# bun install + cache store; layer ini CACHED selama lockfile gak berubah
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---- migrate-tools: HANYA prisma CLI (+ tree-nya) buat migrate deploy ----
# Full prod node_modules ~250MB compressed di image final — dobel sama standalone.
# Prisma CLI tree cuma ~sepersepuluhnya; app runtime sudah di .next/standalone.
FROM oven/bun:1-alpine AS migrate-tools
WORKDIR /tools
COPY package.json ./package.src.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun -e 'const p=require("./package.src.json"); require("fs").writeFileSync("package.json", JSON.stringify({name:"migrate-tools",private:true,dependencies:{prisma:p.dependencies.prisma}}))' \
    && bun install

# ---- builder (node resmi: next build + prisma generate) ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
# prisma dulu biar layer generate cache-hit kalau cuma ubah app source
COPY prisma ./prisma
COPY prisma.config.ts ./
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
# prisma generate cuma butuh DATABASE_URL ke-resolve secara sintaks, gak konek ke DB beneran
RUN npx prisma generate
COPY . .
# cache .next biar compile incremental antar CI run (BuildKit cache mount)
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
# link package ke repo biar GITHUB_TOKEN bisa pull dari GHCR
LABEL org.opencontainers.image.source=https://github.com/ryan-prayoga/kas-badminton
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8200 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma CLI terpisah di /prisma-cli (bukan overwrite node_modules standalone)
COPY --from=migrate-tools --chown=nextjs:nodejs /tools/node_modules /prisma-cli/node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 8200
ENTRYPOINT ["./docker-entrypoint.sh"]
