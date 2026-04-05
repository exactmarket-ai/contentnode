# ContentNode.ai — Claude Code Context

## What this project is
A multi-tenant SaaS platform for node-based content workflow automation.
Full spec is in docs/contentnode-spec-v4.md

## Critical architectural rules — follow these in every file you touch
1. Every database query on tenant data MUST include agency_id as a filter.
   This is enforced by Prisma middleware. Never bypass it.
2. Connectivity mode (online/offline) is set at workflow creation and locked
   after first run. Never allow it to change after that point.
3. BullMQ handles all workflow execution. No synchronous AI calls from API routes.
4. All AI provider calls go through packages/ai/src/provider.ts — never call
   Anthropic/OpenAI/etc. directly from feature code.
5. AuditLog entries are append-only. Never update or delete them.

## Tech stack
- Frontend: React + React Flow + Zustand + TailwindCSS + shadcn/ui
- API: Node.js + Fastify + Prisma
- Database: PostgreSQL with RLS + pgvector
- Queue: Redis + BullMQ
- Auth: Clerk (agency) + custom magic link (client portal)
- Storage: Cloudflare R2 (or local filesystem in dev)
- Default AI: Anthropic Claude claude-sonnet-4-5

## Monorepo structure
- apps/web — React frontend
- apps/api — Fastify API
- packages/database — Prisma schema and migrations
- packages/ai — unified AI provider abstraction
- packages/shared — shared types
- workers/workflow — BullMQ workers

## What has been built
- Session 1 complete: monorepo + database foundation
  - pnpm workspaces (apps/*, packages/*, workers/*)
  - packages/database: Prisma schema (15 tables), AsyncLocalStorage middleware,
    3 migrations (pgvector extension, schema, RLS policies), seed data
- Session 2 complete: Fastify API foundation
  - apps/api: Fastify 4 + TypeScript, @fastify/cors, @fastify/helmet, @fastify/multipart
  - Auth plugin: Clerk JWT verification via verifyToken(), seeds AsyncLocalStorage with
    agency_id via agencyStorage.enterWith() so Prisma middleware picks it up
  - requireRole() helper for route-level RBAC
  - 7 route plugins (stub): /api/v1/workflows, /clients, /nodes, /runs,
    /feedback, /transcriptions, /insights
  - /health endpoint: checks Postgres + Redis, returns 200/503
  - apps/api/src/services/audit.ts: append-only AuditLog service (log + list only)
  - Start with: pnpm dev (from repo root)
  - Env vars: see apps/api/.env.example

## Current session
- Session 2 done. Ready for Session 3.
