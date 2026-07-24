#!/bin/sh
set -e
echo "Running migrations..."
# Prisma CLI di /prisma-cli (slim). NODE_PATH biar prisma.config.ts
# bisa resolve "dotenv/config" + "prisma/config" dari tree CLI itu.
export NODE_PATH=/prisma-cli/node_modules
node /prisma-cli/node_modules/prisma/build/index.js migrate deploy
echo "Starting server on :$PORT"
exec node server.js
