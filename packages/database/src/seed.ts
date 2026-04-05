/**
 * Seed file — creates one test agency, two clients, and four stakeholders.
 * Runs outside agency context so it bypasses the middleware's agency_id injection.
 * Uses the raw PrismaClient (no middleware) to keep seed data predictable.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── Agency ──────────────────────────────────────────────────────────────
  const agency = await prisma.agency.upsert({
    where: { slug: 'acme-agency' },
    update: {},
    create: {
      id: 'agency_acme',
      name: 'Acme Content Agency',
      slug: 'acme-agency',
      clerkOrgId: null,
      plan: 'pro',
    },
  })
  console.log(`  ✓ Agency: ${agency.name} (${agency.id})`)

  // ── Clients ──────────────────────────────────────────────────────────────
  const clientAlpha = await prisma.client.upsert({
    where: { agencyId_slug: { agencyId: agency.id, slug: 'alpha-brand' } },
    update: {},
    create: {
      id: 'client_alpha',
      agencyId: agency.id,
      name: 'Alpha Brand Co.',
      slug: 'alpha-brand',
      industry: 'Consumer Goods',
    },
  })
  console.log(`  ✓ Client: ${clientAlpha.name} (${clientAlpha.id})`)

  const clientBeta = await prisma.client.upsert({
    where: { agencyId_slug: { agencyId: agency.id, slug: 'beta-tech' } },
    update: {},
    create: {
      id: 'client_beta',
      agencyId: agency.id,
      name: 'Beta Tech Inc.',
      slug: 'beta-tech',
      industry: 'Technology',
    },
  })
  console.log(`  ✓ Client: ${clientBeta.name} (${clientBeta.id})`)

  // ── Stakeholders (2 per client) ─────────────────────────────────────────
  const stakeholders = [
    {
      id: 'sh_alice',
      agencyId: agency.id,
      clientId: clientAlpha.id,
      name: 'Alice Johnson',
      email: 'alice@alpha-brand.example.com',
      role: 'CMO',
    },
    {
      id: 'sh_bob',
      agencyId: agency.id,
      clientId: clientAlpha.id,
      name: 'Bob Martinez',
      email: 'bob@alpha-brand.example.com',
      role: 'Brand Manager',
    },
    {
      id: 'sh_carol',
      agencyId: agency.id,
      clientId: clientBeta.id,
      name: 'Carol Nguyen',
      email: 'carol@beta-tech.example.com',
      role: 'VP Marketing',
    },
    {
      id: 'sh_dave',
      agencyId: agency.id,
      clientId: clientBeta.id,
      name: 'Dave Okafor',
      email: 'dave@beta-tech.example.com',
      role: 'Content Lead',
    },
  ]

  for (const sh of stakeholders) {
    const created = await prisma.stakeholder.upsert({
      where: { clientId_email: { clientId: sh.clientId, email: sh.email } },
      update: {},
      create: sh,
    })
    console.log(`  ✓ Stakeholder: ${created.name} <${created.email}>`)
  }

  console.log('\n✅ Seed complete.')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
