import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'
import { createListenerService } from '../src/listeners/index.ts'
import { createPlayerRoom } from '../src/community-rooms.ts'
import { drawMap, eraseMap, readMap } from '../src/tactical-map.ts'
import { controlledDelivery } from './listener-fixture.ts'

// Real PostgreSQL: re-entering as the same character must neither reset the
// per-member stroke quota nor orphan earlier strokes beyond the eraser.
test('map strokes follow the character across re-entry', async () => {
  assert.ok(process.env.DATABASE_URL)
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const databaseName = `babel_map_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${databaseName}`)
  url.pathname = `/${databaseName}`
  const database = createDatabase(url.toString())
  const service = createListenerService(database.db, controlledDelivery().delivery)
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    })
    const { roomId } = await createPlayerRoom(database.db, {
      name: 'Map quota',
      server: 'siel',
      allowedIds: [],
      hostId: 'Pilot',
    })
    async function join(name: string) {
      const credential = randomBytes(32).toString('base64url')
      const request = { nickname: name, outputLanguage: null, requestId: randomUUID() }
      const listener = await service.enter(roomId, request, credential, {
        nickname: name,
        server: 'siel',
        region: 'as',
        profileUrl: `https://aion2index.com/c/as/siel/${name}`,
        description: 'Fixture',
      })
      return { sessionId: listener.sessionId, credential }
    }
    const draw = (member: { sessionId: string; credential: string }) =>
      drawMap(database.db, roomId, member.sessionId, member.credential, {
        id: randomUUID(),
        color: '#fbbf24',
        points: [
          [10, 10],
          [20, 20],
        ],
      })

    const first = await join('Scout')
    for (let index = 0; index < 100; index += 1) {
      await draw(first)
    }
    const second = await join('Scout')
    await assert.rejects(draw(second), { code: 'LIMIT' }, 'quota survives re-entry')

    const strokes = await readMap(
      database.db,
      roomId,
      second.sessionId,
      second.credential,
    )
    assert.equal(strokes.length, 100)
    assert.ok(strokes.every((stroke) => stroke.sessionId === second.sessionId))
    const [earlier] = strokes
    assert.ok(earlier)

    const other = await join('Pilot')
    await eraseMap(database.db, roomId, other.sessionId, other.credential, earlier.id)
    assert.equal(
      (await readMap(database.db, roomId, other.sessionId, other.credential)).length,
      100,
      'other members still cannot erase the stroke',
    )
    await eraseMap(database.db, roomId, second.sessionId, second.credential, earlier.id)
    assert.equal(
      (await readMap(database.db, roomId, second.sessionId, second.credential)).length,
      99,
      'the returning character erases its earlier stroke',
    )
    await draw(second)
  } finally {
    await database.close()
    await administrator.pool.query(`drop database if exists ${databaseName}`)
    await administrator.close()
  }
})
