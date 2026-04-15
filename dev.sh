#!/bin/bash
# Launch all ContentNode local dev services in separate Terminal tabs.
# Usage: ./dev.sh

REPO="$(cd "$(dirname "$0")" && pwd)"

open_tab() {
  local title="$1"
  local cmd="$2"
  osascript <<EOF
tell application "Terminal"
  tell application "System Events" to keystroke "t" using {command down}
  delay 0.3
  do script "printf '\\\\e]0;${title}\\\\a'; cd '${REPO}' && ${cmd}" in front window
end tell
EOF
}

echo "Starting ContentNode dev services..."

# API (Fastify)
open_tab "CN: API"    "pnpm dev:api"

# Workflow worker (BullMQ)
open_tab "CN: Worker" "pnpm dev:worker"

# Web (Vite)
open_tab "CN: Web"    "pnpm dev:web"

echo "Done — check Terminal tabs for each service."
echo ""
echo "  API    → http://localhost:3000"
echo "  Web    → http://localhost:5173"
echo "  Worker → background process (no HTTP port)"
