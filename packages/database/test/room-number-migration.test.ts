import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'

// The HTTP suite starts empty. This owns populated-schema upgrades and the
// durable sequence across concurrent writers, deletion and repeated migration.
test('existing rooms receive chronological numbers and later creation never reuses them', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const name = `babel_room_numbers_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${name}`)
  url.pathname = `/${name}`
  const database = createDatabase(url.toString())
  const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
  const previous = await mkdtemp(join(tmpdir(), 'babel-room-numbers-'))
  const older = randomUUID()
  const newer = randomUUID()
  try {
    await cp(migrations, previous, { recursive: true })
    const journalPath = join(previous, 'meta/_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 17)
    await writeFile(journalPath, JSON.stringify(journal))
    await migrate(database.db, { migrationsFolder: previous })
    // Reverse insertion order makes storage order different from creation order.
    for (const [id, date] of [
      [newer, '2026-10-02'],
      [older, '2026-10-01'],
    ]) {
      await database.pool.query(
        'insert into room(id,name,created_at) values($1,$2,$3)',
        [id, 'Existing room', date],
      )
      await database.pool.query(
        "insert into community_room(room_id,guild_id,creator_id,server,allowed_ids) values($1,'fixture-guild','fixture-creator','siel','[\"Pilot\"]')",
        [id],
      )
    }
    await migrate(database.db, { migrationsFolder: migrations })
    assert.deepEqual(
      (
        await database.pool.query(
          'select room_id,number,allowed_ids from community_room order by number',
        )
      ).rows,
      [
        { room_id: older, number: 1, allowed_ids: ['Pilot'] },
        { room_id: newer, number: 2, allowed_ids: ['Pilot'] },
      ],
    )
    async function create() {
      const id = randomUUID()
      await database.pool.query('insert into room(id,name) values($1,$2)', [
        id,
        'New room',
      ])
      const result = await database.pool.query<{ number: number }>(
        "insert into community_room(room_id,guild_id,creator_id,server) values($1,'fixture-guild','fixture-creator','siel') returning number",
        [id],
      )
      return result.rows[0]!.number
    }
    assert.deepEqual((await Promise.all([create(), create()])).sort(), [3, 4])
    await database.pool.query('delete from room where id=$1', [older])
    await migrate(database.db, { migrationsFolder: migrations })
    assert.equal(
      await create(),
      5,
      'deletion and migration retry do not reset numbering',
    )
    assert.equal(
      (
        await database.pool.query(
          'select number from community_room where room_id=$1',
          [newer],
        )
      ).rows[0].number,
      2,
    )
  } finally {
    await database.close()
    await administrator.pool.query(`drop database ${name}`)
    await administrator.close()
    await rm(previous, { recursive: true, force: true })
  }
})
