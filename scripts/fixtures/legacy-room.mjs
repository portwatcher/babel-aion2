import assert from 'node:assert/strict'
import pg from 'pg'

// Older API/transport suites own their fixture explicitly. Application reads
// must never create a default room as a side effect.
export async function seedLegacyRoom(databaseUrl) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  const id = '00000000-0000-4000-8000-000000000001'
  try {
    await client.query(
      'insert into room(id,name) values($1,$2) on conflict do nothing',
      [id, 'Legacy test room'],
    )
    return id
  } finally {
    await client.end()
  }
}
