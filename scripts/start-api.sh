#!/bin/sh
set -e

echo "=== ContentNode API starting ==="
echo "NODE_ENV: $NODE_ENV"
echo "PORT: $PORT"
echo "DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"
echo "REDIS_URL set: $([ -n "$REDIS_URL" ] && echo yes || echo NO)"

echo "Starting API server..."
exec node apps/api/dist/index.js
