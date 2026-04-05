---
name: Session 1 — Monorepo & Database Foundation
description: What was built in Session 1 — pnpm workspace setup, Prisma schema, RLS migrations, seed data
type: project
---

Session 1 (2026-04-05) is complete: monorepo scaffold + database foundation built.

**Why:** This is the foundational session establishing the multi-tenant data model and enforcement mechanisms.

**How to apply:** Session 2 will build on this. The database is live and seeded. Prisma client is generated. No API or frontend code exists yet.

## What was built

### Monorepo
- Root `package.json` + `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `workers/*`
- `tsconfig.base.json` shared TypeScript config
- `pnpm-workspace.yaml` has `onlyBuiltDependencies` for `@prisma/client`, `@prisma/engines`, `esbuild`, `prisma`

### packages/database
- Prisma schema: 15 tables — Agency, Client, Stakeholder, User, Workflow, Node, Edge, Document, WorkflowRun, Feedback, TranscriptSession, TranscriptSegment, Insight, UsageRecord, AuditLog
- Every tenant table has `agency_id` as non-nullable indexed field
- Middleware: `packages/database/src/middleware.ts` — AsyncLocalStorage-based `withAgency()` / `requireAgencyId()`, Prisma middleware that auto-injects `agency_id` into all queries on tenant-scoped models
- Client: `packages/database/src/client.ts` — singleton PrismaClient with middleware applied
- Exports: `packages/database/src/index.ts`

### Migrations (in order)
1. `20260405000001_extensions` — enables pgvector extension
2. `20260405000002_init` — creates all 15 tables with indexes and foreign keys
3. `20260405000003_rls` — enables Row Level Security on all 14 tenant tables, creates `current_agency_id()` function, and `agency_isolation` policies

### Seed data
- 1 agency: Acme Content Agency (id: agency_acme, slug: acme-agency)
- 2 clients: Alpha Brand Co. (client_alpha), Beta Tech Inc. (client_beta)
- 4 stakeholders: Alice Johnson (CMO), Bob Martinez (Brand Manager), Carol Nguyen (VP Marketing), Dave Okafor (Content Lead)

### Database connection
- postgresql://contentnode:contentnode_dev@localhost:5432/contentnode
- Running via docker-compose (pgvector/pgvector:pg16 image)
- Redis also running on port 6379
