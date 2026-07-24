#!/bin/sh
set -e
echo "Running migrations..."
# Prisma CLI di /prisma-cli (slim tree), schema/config di /app
node /prisma-cli/node_modules/prisma/build/index.js migrate deploy
echo "Starting server on :$PORT"
exec node server.js
