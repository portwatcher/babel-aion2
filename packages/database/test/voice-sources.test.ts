import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { eq, inArray } from 'drizzle-orm'
import { createDatabase } from '../src/client.ts'
import { createCredentialCipher } from '../src/credentials.ts'
import { startRoom, stopRoom, updateRoomSettings } from '../src/room-settings.ts'
import { auditEvent, room } from '../src/schema/rooms.ts'
import { voiceSourceRun } from '../src/schema/voice-sources.ts'
import { claimVoiceSource, readVoiceSources } from '../src/voice-sources.ts'

async function fixture(t: TestContext) {
  assert.ok(process.env.DATABASE_URL, 'Use disposable PostgreSQL')
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const actor = `source-test:${randomUUID()}`
  url.searchParams.set('application_name', actor)
  const database = createDatabase(url.toString(), { queryTimeoutMs: 2_000 })
  const ids = [randomUUID(), randomUUID()]
  const cipher = createCredentialCipher(randomBytes(32).toString('base64'))
  await database.db.insert(room).values(ids.map((id) => ({ id, name: actor })))
  const leases: Awaited<ReturnType<typeof claimVoiceSource>>[] = []
  t.after(async () => {
    try {
      await Promise.all(leases.map((lease) => lease.abandon()))
      await database.db
        .delete(voiceSourceRun)
        .where(inArray(voiceSourceRun.roomId, ids))
      await database.db.delete(auditEvent).where(eq(auditEvent.actorSubject, actor))
      await database.db.delete(room).where(inArray(room.id, ids))
    } finally {
      await database.close()
    }
  })
  async function stored(id: string) {
    const source = (await readVoiceSources(database.db)).find(
      (source) => source.id === id,
    )
    assert.ok(source)
    return source
  }
  async function configure(id: string) {
    return updateRoomSettings(
      database.db,
      id,
      {
        expectedVersion: (await stored(id)).configurationVersion,
        name: actor,
        guildId: '10000000000000001',
        voiceChannelId: '10000000000000002',
        captureMode: 'ALL_CHANNEL',
        commanderIds: [],
        credential: 'local-test-credential',
        removeCredential: false,
      },
      actor,
      cipher,
    )
  }
  return { database, ids, cipher, actor, stored, configure, leases }
}

test('room start validates configuration and key, persists intent and fences stop or source changes', async (t) => {
  const f = await fixture(t)
  const id = f.ids[0]!
  const initial = await f.stored(id)
  await assert.rejects(
    startRoom(f.database.db, id, initial.configurationVersion, f.actor, f.cipher),
    {
      code: 'INVALID_CONFIGURATION',
    },
  )
  const configured = await f.configure(id)
  await assert.rejects(
    startRoom(
      f.database.db,
      id,
      configured.version,
      f.actor,
      createCredentialCipher(randomBytes(32).toString('base64')),
    ),
  )
  assert.equal((await f.stored(id)).stopped, true)
  await assert.rejects(
    startRoom(f.database.db, id, configured.version - 1, f.actor, f.cipher),
    {
      code: 'VERSION_CONFLICT',
    },
  )
  const started = await startRoom(
    f.database.db,
    id,
    configured.version,
    f.actor,
    f.cipher,
  )
  assert.equal(started.stopped, false)
  assert.ok(started.sourceGeneration > configured.sourceGeneration)
  assert.deepEqual(
    await startRoom(f.database.db, id, started.version, f.actor, f.cipher),
    started,
  )
  const stopped = await stopRoom(f.database.db, id, started.version, f.actor)
  assert.equal((await f.stored(id)).stopped, true)
  assert.ok(stopped.sourceGeneration > started.sourceGeneration)
  const restarted = await startRoom(
    f.database.db,
    id,
    stopped.version,
    f.actor,
    f.cipher,
  )
  const changed = await updateRoomSettings(
    f.database.db,
    id,
    {
      expectedVersion: restarted.version,
      name: f.actor,
      guildId: '10000000000000001',
      voiceChannelId: '10000000000000003',
      captureMode: 'SELECTED_USERS',
      commanderIds: ['10000000000000004'],
      removeCredential: false,
    },
    f.actor,
    f.cipher,
  )
  assert.equal(changed.stopped, true)
  assert.ok(changed.sourceGeneration > restarted.sourceGeneration)
  const audit = await f.database.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.actorSubject, f.actor))
  assert.equal(audit.filter((event) => event.action === 'room.start').length, 2)
  assert.equal(JSON.stringify(audit).includes('local-test-credential'), false)
})

test('PostgreSQL ownership excludes duplicate controllers and preserves an unconfirmed owner after session loss', async (t) => {
  const f = await fixture(t)
  for (const id of f.ids) {
    const configured = await f.configure(id)
    await startRoom(f.database.db, id, configured.version, f.actor, f.cipher)
  }
  const [a, b] = f.ids
  assert.ok(a && b)
  const before = await f.stored(a)
  let lost = false
  const lease = await claimVoiceSource(
    f.database.db,
    f.database.pool,
    before,
    '10000000000000005',
    randomUUID(),
    () => {
      lost = true
    },
  )
  f.leases.push(lease)
  assert.ok(lease.valid())
  assert.ok(lease.source.sourceGeneration > before.sourceGeneration)
  await assert.rejects(
    claimVoiceSource(
      f.database.db,
      f.database.pool,
      await f.stored(b),
      '10000000000000005',
      randomUUID(),
      () => {},
    ),
    { name: 'Error' },
  )
  await assert.rejects(
    claimVoiceSource(
      f.database.db,
      f.database.pool,
      await f.stored(a),
      '10000000000000006',
      randomUUID(),
      () => {},
    ),
  )

  const owner = await f.database.pool.query<{ pid: number }>(
    `select distinct a.pid from pg_stat_activity a join pg_locks l on l.pid=a.pid
     where a.application_name=$1 and l.locktype='advisory' and l.granted`,
    [f.actor],
  )
  assert.equal(owner.rows.length, 1)
  await f.database.pool.query('select pg_terminate_backend($1)', [owner.rows[0]!.pid])
  const deadline = Date.now() + 3_000
  while (!lost && Date.now() < deadline) {
    await delay(20)
  }
  assert.equal(lost, true, 'Lost PostgreSQL control must invalidate the source')
  assert.equal(lease.valid(), false)
  await assert.rejects(
    claimVoiceSource(
      f.database.db,
      f.database.pool,
      await f.stored(a),
      '10000000000000005',
      randomUUID(),
      () => {},
    ),
  )

  // This exercises the ownership store only; no Discord receiver or media peer
  // was started. It is not evidence of a physical transport close.
  await lease.close()
  const next = await claimVoiceSource(
    f.database.db,
    f.database.pool,
    await f.stored(a),
    '10000000000000005',
    randomUUID(),
    () => {},
  )
  f.leases.push(next)
  assert.ok(next.source.sourceGeneration > lease.source.sourceGeneration)
  await next.abandon()
  await assert.rejects(
    claimVoiceSource(
      f.database.db,
      f.database.pool,
      await f.stored(a),
      '10000000000000005',
      randomUUID(),
      () => {},
    ),
  )
})
