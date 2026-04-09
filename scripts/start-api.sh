#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

echo "Starting API server..."
exec node --import tsx/esm apps/api/src/index.ts
