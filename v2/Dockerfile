# syntax=docker/dockerfile:1

# ---- deps (build-time, termasuk devDeps buat next/typescript) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate cuma butuh DATABASE_URL ke-resolve secara sintaks, gak konek ke DB beneran
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN npx prisma generate
RUN npm run build

# ---- prod-deps (runtime saja: tanpa eslint/vitest/typescript/dll) ----
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

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
# node_modules production (bukan full+devDeps) - prisma CLI butuh dependency
# transitif yang gak ke-trace sama standalone output next.js
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 8200
ENTRYPOINT ["./docker-entrypoint.sh"]
