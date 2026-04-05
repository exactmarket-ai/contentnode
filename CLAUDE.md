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
- Nothing yet. Session 1 is next.

## Current session
- Ready to start Session 1: monorepo setup and database foundation
