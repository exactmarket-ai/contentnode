import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'prompt_templates' 
    ORDER BY ordinal_position
  `)
  console.log('=== COLUMNS ===')
  console.table(cols)

  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, name, created_by, deleted_at, deleted_by 
    FROM prompt_templates 
    ORDER BY created_at DESC 
    LIMIT 20
  `)
  console.log('\n=== DATA (last 20) ===')
  console.table(rows)
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect() })
