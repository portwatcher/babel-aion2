import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { createDatabase } from '../src/client.ts'
import { createCredentialCipher } from '../src/credentials.ts'
import { createListenerService, openMediaConnection } from '../src/listeners/index.ts'
import { startRoom, updateRoomSettings } from '../src/room-settings.ts'
import { claimVoiceSource } from '../src/voice-sources.ts'
import { room } from '../src/schema/rooms.ts'
import {
  confirmRuntimeExit,
  registerRuntimeOwner,
  RuntimeOwnerUnavailable,
} from '../src/runtime-owners.ts'

async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await delay(20)
  }
  assert.fail('Expected PostgreSQL transaction to block')
}

test('an exit receipt waits for pending registration, fences late requests and releases only that voice generation', async (t) => {
  assert.ok(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  )
  const roomId = randomUUID(),
    ownerId = randomUUID(),
    successor = randomUUID()
  const actor = `runtime-${randomUUID().slice(0, 12)}`
  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.set('application_name', actor)
  const database = createDatabase(url.toString())
  const credential = randomBytes(32).toString('base64url')
  const cipher = createCredentialCipher(randomBytes(32).toString('base64'))
  const leases: Awaited<ReturnType<typeof claimVoiceSource>>[] = []
  let held: PoolClient | undefined
  t.after(async () => {
    await held?.query('rollback')
    held?.release()
    await Promise.all(leases.map((lease) => lease.abandon()))
    await database.pool.query('delete from voice_source_run where room_id=$1', [roomId])
    await database.pool.query('delete from listener_session where room_id=$1', [roomId])
    await database.pool.query('delete from nickname where key=$1', [actor])
    await database.pool.query('delete from audit_event where actor_subject=$1', [actor])
    await database.pool.query('delete from room where id=$1', [roomId])
    await database.pool.query('delete from runtime_owner where id=any($1)', [
      [ownerId, successor],
    ])
    await database.close()
  })
  await database.db.insert(room).values({ id: roomId, name: actor })
  await registerRuntimeOwner(database.db, ownerId)
  await registerRuntimeOwner(database.db, successor)
  // These are storage transactions only; the process test owns physical exit
  // proof. No Discord or media transport is started by this database test.
  const service = createListenerService(database.db, {
    ready: async () => true,
    revokeMedia: async () => true,
    revokeSubtitles: async () => true,
  })
  const session = await service.enter(
    roomId,
    {
      nickname: actor,
      outputLanguage: null,
      requestId: randomUUID(),
    },
    credential,
  )
  const configured = await updateRoomSettings(
    database.db,
    roomId,
    {
      expectedVersion: 1,
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
  await startRoom(database.db, roomId, configured.version, actor, cipher)
  async function source() {
    const [record] = await database.db.select().from(room).where(eq(room.id, roomId))
    assert.ok(record)
    return record
  }
  const first = await claimVoiceSource(
    database.db,
    database.pool,
    await source(),
    '10000000000000003',
    ownerId,
    () => {},
  )
  leases.push(first)
  await first.abandon()
  await assert.rejects(
    claimVoiceSource(
      database.db,
      database.pool,
      await source(),
      '10000000000000003',
      successor,
      () => {},
    ),
  )

  held = await database.pool.connect()
  await held.query('begin')
  const pid = (await held.query('select pg_backend_pid() as pid')).rows[0].pid
  await held.query('select key from nickname where key=$1 for update', [actor])
  const connectionId = randomUUID()
  const admission = openMediaConnection(
    database.db,
    connectionId,
    ownerId,
    1,
    session,
    credential,
  )
  await until(
    async () =>
      (
        await database.pool.query(
          'select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as blocked',
          [pid],
        )
      ).rows[0].blocked,
  )
  const exiting = confirmRuntimeExit(database.db, ownerId)
  await until(
    async () =>
      (
        await database.pool.query(
          "select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like '%runtime_owner%') as blocked",
          [actor],
        )
      ).rows[0].blocked,
  )
  await held.query('commit')
  held.release()
  held = undefined
  await Promise.all([admission, exiting])
  const closed = (
    await database.pool.query('select closed_at from media_connection where id=$1', [
      connectionId,
    ])
  ).rows[0]
  assert.ok(closed.closed_at, 'Exit missed a registration committed during shutdown')
  await assert.rejects(
    registerRuntimeOwner(database.db, ownerId),
    RuntimeOwnerUnavailable,
  )
  await assert.rejects(
    openMediaConnection(database.db, randomUUID(), ownerId, 2, session, credential),
    RuntimeOwnerUnavailable,
  )
  await assert.rejects(
    claimVoiceSource(
      database.db,
      database.pool,
      await source(),
      '10000000000000003',
      ownerId,
      () => {},
    ),
    RuntimeOwnerUnavailable,
  )
  const next = await claimVoiceSource(
    database.db,
    database.pool,
    await source(),
    '10000000000000003',
    successor,
    () => {},
  )
  leases.push(next)
  assert.ok(next.source.sourceGeneration > first.source.sourceGeneration)
  await confirmRuntimeExit(database.db, ownerId)
  const survivor = (
    await database.pool.query(
      'select closed_at from voice_source_run where owner_id=$1',
      [successor],
    )
  ).rows[0]
  assert.equal(survivor.closed_at, null, 'Late exit confirmation closed the new source')
})
