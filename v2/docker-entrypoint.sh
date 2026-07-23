#!/bin/sh
set -e
echo "Running migrations..."
node node_modules/prisma/build/index.js migrate deploy || npx prisma migrate deploy
echo "Starting server on :$PORT"
exec node server.js
