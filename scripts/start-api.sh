#!/bin/sh
set -e

echo "=== ContentNode API starting ==="
echo "NODE_ENV: $NODE_ENV"
echo "PORT: $PORT"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"
echo "REDIS_URL set: $([ -n "$REDIS_URL" ] && echo yes || echo NO)"

echo "Syncing database schema..."
pnpm --filter @contentnode/database db:push:safe 2>&1 | sed 's|postgresql://[^[:space:]]*|[REDACTED]|g'

echo "Applying database functions..."
pnpm --filter @contentnode/database apply-functions || echo "Warning: apply-functions failed — existing function will be used"

echo "Starting API server..."
exec node --import tsx/esm apps/api/src/index.ts
