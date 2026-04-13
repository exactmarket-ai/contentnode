#!/usr/bin/env bash
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✘${NC} $1"; exit 1; }
step() { echo -e "\n${BOLD}$1${NC}"; }

step "=== ContentNode — new machine setup ==="

# ── Prerequisites ──────────────────────────────────────────────────────────
step "Checking prerequisites..."

node_ver=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1) || fail "Node.js not found. Install Node 20+."
[ "$node_ver" -ge 20 ] && ok "Node.js $(node --version)" || fail "Node.js 20+ required (found v$node_ver)"

pnpm --version &>/dev/null && ok "pnpm $(pnpm --version)" || fail "pnpm not found. Run: npm i -g pnpm"

docker info &>/dev/null && ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')" || warn "Docker not running — you'll need it for local Postgres + Redis"

# ── .env files ────────────────────────────────────────────────────────────
step "Setting up .env files..."

copy_env() {
  local example="$1" target="$2"
  if [ -f "$target" ]; then
    ok "$target already exists (skipped)"
  elif [ -f "$example" ]; then
    cp "$example" "$target"
    warn "$target created from example — fill in real values before running"
  else
    warn "No $example found — skipping"
  fi
}

copy_env apps/api/.env.example     apps/api/.env
copy_env apps/web/.env.example     apps/web/.env
copy_env apps/api/.env.example     workers/workflow/.env  # worker uses same vars

# ── Dependencies ───────────────────────────────────────────────────────────
step "Installing dependencies..."
pnpm install && ok "pnpm install done"

# ── Docker services ───────────────────────────────────────────────────────
step "Starting Postgres + Redis via Docker Compose..."
if docker info &>/dev/null; then
  docker compose up -d && ok "Postgres + Redis started"
  echo "  Waiting for Postgres to be ready..."
  for i in $(seq 1 20); do
    docker compose exec -T postgres pg_isready -U contentnode -d contentnode &>/dev/null && break
    sleep 1
  done
  docker compose exec -T postgres pg_isready -U contentnode -d contentnode &>/dev/null \
    && ok "Postgres ready" || warn "Postgres not responding — check: docker compose logs postgres"
else
  warn "Docker not available — skipping. Start Postgres + Redis manually and set DATABASE_URL / REDIS_URL in .env files."
fi

# ── Database ───────────────────────────────────────────────────────────────
step "Generating Prisma client + pushing schema..."
if docker info &>/dev/null && docker compose exec -T postgres pg_isready -U contentnode -d contentnode &>/dev/null; then
  pnpm db:generate && ok "Prisma client generated"
  pnpm --filter @contentnode/database db:push && ok "Schema pushed"
  echo ""
  read -r -p "Seed database with demo data? [y/N] " seed_answer
  if [[ "$seed_answer" =~ ^[Yy]$ ]]; then
    pnpm db:seed && ok "Seed complete"
  fi
else
  warn "Skipping DB setup — Postgres not available. Run later: pnpm db:generate && pnpm --filter @contentnode/database db:push"
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== Setup complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit apps/api/.env with your CLERK_SECRET_KEY and ANTHROPIC_API_KEY"
echo "  2. Edit apps/web/.env with your VITE_CLERK_PUBLISHABLE_KEY (optional for local dev)"
echo "  3. Start dev servers:"
echo "       pnpm dev:api      → API on http://localhost:3001"
echo "       pnpm dev:worker   → BullMQ worker"
echo "       pnpm dev:web      → Web on http://localhost:5173"
