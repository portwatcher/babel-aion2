import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'
import {
  closePlayerConnection,
  createListenerService,
  openMediaConnection,
  openPlayerConnection,
  renewPlayerConnections,
} from '../src/listeners/index.ts'
import {
  confirmRuntimeExit,
  listActiveVoiceWorkers,
  readVoiceScaleLoad,
  registerRuntimeOwner,
  setRuntimeOwnerControlUrl,
} from '../src/runtime-owners.ts'
import { room } from '../src/schema/rooms.ts'

test('fanout-only metadata, scale load counts and batched heartbeat renewals enforce fencing', async () => {
  assert.ok(process.env.DATABASE_URL)
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const databaseName = `babel_scale_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${databaseName}`)
  url.pathname = `/${databaseName}`
  const database = createDatabase(url.toString())
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    })

    const webOwner = randomUUID()
    const otherWebOwner = randomUUID()
    const baseWorker = randomUUID()
    const burstWorker = randomUUID()
    const activeRoomId = randomUUID()
    const disbandedRoomId = randomUUID()

    await database.db.insert(room).values([
      { id: activeRoomId, name: 'scale-active' },
      { id: disbandedRoomId, name: 'scale-disbanded' },
    ])
    await registerRuntimeOwner(database.db, webOwner)
    await registerRuntimeOwner(database.db, otherWebOwner)
    await registerRuntimeOwner(database.db, baseWorker)
    await registerRuntimeOwner(database.db, burstWorker)
    await setRuntimeOwnerControlUrl(database.db, baseWorker, 'http://127.0.0.1:4201')
    await setRuntimeOwnerControlUrl(database.db, burstWorker, 'http://127.0.0.1:4202', {
      fanoutOnly: true,
    })

    const workers = await listActiveVoiceWorkers(database.db)
    assert.equal(workers.find((w) => w.ownerId === baseWorker)?.fanoutOnly, false)
    assert.equal(workers.find((w) => w.ownerId === burstWorker)?.fanoutOnly, true)

    const service = createListenerService(database.db, {
      ready: async () => true,
      revokeMedia: async () => true,
      revokeSubtitles: async () => true,
    })
    const credA = randomBytes(32).toString('base64url')
    const credB = randomBytes(32).toString('base64url')
    const credC = randomBytes(32).toString('base64url')
    const credD = randomBytes(32).toString('base64url')
    const credReplaced = randomBytes(32).toString('base64url')

    const sessA = await service.enter(
      activeRoomId,
      { nickname: 'alice', outputLanguage: null, requestId: randomUUID() },
      credA,
    )
    const sessB = await service.enter(
      activeRoomId,
      { nickname: 'bob', outputLanguage: null, requestId: randomUUID() },
      credB,
    )
    const sessC = await service.enter(
      activeRoomId,
      { nickname: 'charlie', outputLanguage: null, requestId: randomUUID() },
      credC,
    )
    const sessDisbanded = await service.enter(
      disbandedRoomId,
      { nickname: 'dana', outputLanguage: null, requestId: randomUUID() },
      credD,
    )
    assert.equal(sessDisbanded.state, 'ACTIVE')
    await database.pool.query('update room set disbanded_at = now() where id = $1', [
      disbandedRoomId,
    ])

    const connA = randomUUID()
    const connB = randomUUID()
    const connC = randomUUID()
    await openPlayerConnection(database.db, connA, webOwner, sessA.sessionId, credA)
    await openPlayerConnection(database.db, connB, webOwner, sessB.sessionId, credB)
    await openPlayerConnection(
      database.db,
      connC,
      otherWebOwner,
      sessC.sessionId,
      credC,
    )
    await openMediaConnection(database.db, randomUUID(), burstWorker, 1, sessA, credA)

    const load = await readVoiceScaleLoad(database.db)
    assert.deepEqual(load, {
      activeSessions: 3,
      openMediaConnections: 1,
      activeVoiceSources: 0,
      activeFanoutWorkers: 1,
    })

    // Close connB, replace bob, and attempt renewal across mixed states.
    await closePlayerConnection(database.db, connB, webOwner)
    const sessA2 = await service.enter(
      activeRoomId,
      { nickname: 'alice', outputLanguage: null, requestId: randomUUID() },
      credReplaced,
    )
    const connA2 = randomUUID()
    await openPlayerConnection(
      database.db,
      connA2,
      webOwner,
      sessA2.sessionId,
      credReplaced,
    )
    await database.pool.query(
      'update listener_session set last_seen_at = $1 where id = any($2)',
      [
        new Date(0),
        [sessA.sessionId, sessA2.sessionId, sessB.sessionId, sessC.sessionId],
      ],
    )
    await renewPlayerConnections(database.db, [connA, connA2, connB, connC], webOwner)

    const { rows } = await database.pool.query(
      'select id, last_seen_at from listener_session where id = any($1)',
      [[sessA.sessionId, sessA2.sessionId, sessB.sessionId, sessC.sessionId]],
    )
    const seen = new Map(rows.map((row) => [row.id, row.last_seen_at.getTime()]))
    assert.equal(seen.get(sessA.sessionId), 0, 'replaced session was not renewed')
    assert.ok((seen.get(sessA2.sessionId) ?? 0) > 0, 'current open connection renewed')
    assert.equal(seen.get(sessB.sessionId), 0, 'closed connection was not renewed')
    assert.equal(
      seen.get(sessC.sessionId),
      0,
      'foreign-owner connection was not renewed',
    )

    await confirmRuntimeExit(database.db, burstWorker)
    const afterExit = await readVoiceScaleLoad(database.db)
    assert.equal(afterExit.activeFanoutWorkers, 0)
    assert.equal(afterExit.openMediaConnections, 0)
  } finally {
    await database.close()
    await administrator.pool.query(`drop database if exists ${databaseName}`)
    await administrator.close()
  }
})
