import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { createDatabase } from '../src/client.ts'
import { createCredentialCipher } from '../src/credentials.ts'
import {
  createListenerService,
  openMediaConnection,
  openPlayerConnection,
} from '../src/listeners/index.ts'
import { startRoom, updateRoomSettings } from '../src/room-settings.ts'
import {
  claimVoiceSource,
  readActiveVoiceSourceOwners,
  readRoomVoiceOwner,
} from '../src/voice-sources.ts'
import { room } from '../src/schema/rooms.ts'
import {
  confirmRuntimeExit,
  listActiveVoiceWorkers,
  readMediaConnectionOwnerUrl,
  readOpenMediaConnectionOwnerUrls,
  registerRuntimeOwner,
  RuntimeOwnerUnavailable,
  setRuntimeOwnerControlUrl,
} from '../src/runtime-owners.ts'
import { readSubtitlePaths, type LiveSubtitlePath } from '../src/subtitles.ts'
import { createProviderService } from '../src/providers/index.ts'
import { createLanguageService } from '../src/languages/index.ts'
import { createTermService } from '../src/terms.ts'

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
  const playerId = randomUUID()
  const legacyId = randomUUID()
  // Legacy registrations deliberately have no invented process identity.
  await database.pool.query(
    'insert into player_connection(id,session_id,nickname_generation) values($1,$2,$3)',
    [legacyId, session.sessionId, session.nicknameGeneration],
  )
  await openPlayerConnection(
    database.db,
    playerId,
    ownerId,
    session.sessionId,
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
  assert.deepEqual(
    (
      await database.pool.query(
        'select owner_id,closed_at from player_connection where id=$1',
        [legacyId],
      )
    ).rows[0],
    { owner_id: null, closed_at: null },
  )
  assert.ok(
    (
      await database.pool.query('select closed_at from player_connection where id=$1', [
        playerId,
      ])
    ).rows[0].closed_at,
  )
  await assert.rejects(
    openPlayerConnection(
      database.db,
      randomUUID(),
      ownerId,
      session.sessionId,
      credential,
    ),
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

test('worker control URLs track load, room source ownership and cached subtitle path invalidation', async (t) => {
  assert.ok(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  )
  const database = createDatabase(process.env.DATABASE_URL)
  const cipher = createCredentialCipher(randomBytes(32).toString('base64'))
  const workerA = randomUUID()
  const workerB = randomUUID()
  const roomPrimary = randomUUID()
  const roomSibling = randomUUID()
  const providerId = randomUUID()
  const termId = randomUUID()
  const guildId = `9${Math.floor(Math.random() * 1e16)}`.padEnd(17, '1').slice(0, 17)
  const actor = `dist-${randomUUID().slice(0, 10)}`
  const languageCode = 'it-CH'
  const credential = randomBytes(32).toString('base64url')
  const leases: Awaited<ReturnType<typeof claimVoiceSource>>[] = []
  t.after(async () => {
    await Promise.all(leases.map((lease) => lease.abandon()))
    await database.pool.query('delete from voice_source_run where room_id = any($1)', [
      [roomPrimary, roomSibling],
    ])
    await database.pool.query('delete from media_connection where owner_id = any($1)', [
      [workerA, workerB],
    ])
    await database.pool.query('delete from listener_session where room_id = any($1)', [
      [roomPrimary, roomSibling],
    ])
    await database.pool.query('delete from nickname where key = $1', [actor])
    await database.pool.query('delete from output_language where code = $1', [
      languageCode,
    ])
    await database.pool.query('delete from provider_configuration where id = $1', [
      providerId,
    ])
    await database.pool.query('delete from game_term where id = $1', [termId])
    await database.pool.query('delete from audit_event where actor_subject = $1', [
      actor,
    ])
    await database.pool.query('delete from room where id = any($1)', [
      [roomPrimary, roomSibling],
    ])
    await database.pool.query('delete from runtime_owner where id = any($1)', [
      [workerA, workerB],
    ])
    await database.close()
  })

  await registerRuntimeOwner(database.db, workerA)
  await registerRuntimeOwner(database.db, workerB)
  await setRuntimeOwnerControlUrl(database.db, workerA, 'http://127.0.0.1:4101')
  await setRuntimeOwnerControlUrl(database.db, workerB, 'http://127.0.0.1:4102')

  await database.db.insert(room).values([
    { id: roomPrimary, name: `${actor}-primary`, discordGuildId: guildId },
    { id: roomSibling, name: `${actor}-sibling`, discordGuildId: guildId },
  ])
  const configured = await updateRoomSettings(
    database.db,
    roomPrimary,
    {
      expectedVersion: 1,
      name: `${actor}-primary`,
      guildId,
      voiceChannelId: '10000000000000099',
      captureMode: 'ALL_CHANNEL',
      commanderIds: [],
      credential: 'local-test-credential',
      removeCredential: false,
    },
    actor,
    cipher,
  )
  await startRoom(database.db, roomPrimary, configured.version, actor, cipher)
  const [primaryRecord] = await database.db
    .select()
    .from(room)
    .where(eq(room.id, roomPrimary))
  assert.ok(primaryRecord)
  const lease = await claimVoiceSource(
    database.db,
    database.pool,
    primaryRecord,
    '10000000000000088',
    workerA,
    () => {},
  )
  leases.push(lease)

  const primaryOwner = await readRoomVoiceOwner(database.db, roomPrimary)
  const siblingOwner = await readRoomVoiceOwner(database.db, roomSibling)
  assert.equal(primaryOwner?.ownerId, workerA)
  assert.equal(primaryOwner?.controlUrl, 'http://127.0.0.1:4101')
  assert.equal(siblingOwner?.ownerId, workerA)
  assert.equal(siblingOwner?.controlUrl, 'http://127.0.0.1:4101')
  assert.equal(siblingOwner?.runId, primaryOwner?.runId)
  assert.ok(
    (await readActiveVoiceSourceOwners(database.db)).some(
      (entry) => entry.ownerId === workerA && entry.roomId === roomPrimary,
    ),
  )

  const service = createListenerService(database.db, {
    ready: async () => true,
    revokeMedia: async () => true,
    revokeSubtitles: async () => true,
  })
  const session = await service.enter(
    roomPrimary,
    { nickname: actor, outputLanguage: null, requestId: randomUUID() },
    credential,
  )
  const connectionId = randomUUID()
  await openMediaConnection(database.db, connectionId, workerB, 1, session, credential)

  const workers = await listActiveVoiceWorkers(database.db)
  const rowA = workers.find((w) => w.ownerId === workerA)
  const rowB = workers.find((w) => w.ownerId === workerB)
  assert.equal(rowA?.activeConnections, 0)
  assert.equal(rowB?.activeConnections, 1)
  assert.deepEqual(await readMediaConnectionOwnerUrl(database.db, connectionId), {
    ownerId: workerB,
    controlUrl: 'http://127.0.0.1:4102',
  })
  assert.deepEqual(await readOpenMediaConnectionOwnerUrls(database.db, session), [
    { ownerId: workerB, controlUrl: 'http://127.0.0.1:4102' },
  ])

  await confirmRuntimeExit(database.db, workerB)
  assert.equal(
    (await listActiveVoiceWorkers(database.db)).some((w) => w.ownerId === workerB),
    false,
  )

  // Cached subtitle path reader returns the exact cached objects when unchanged
  // and reloads immediately when terminology version advances.
  const providers = createProviderService(database.db, cipher, async () => ({
    code: 'PASS',
    checkedAt: new Date().toISOString(),
    durationMs: 1,
  }))
  await providers.save(
    providerId,
    {
      expectedVersion: 0,
      name: `${actor}-openai`,
      credential: 'sk-test-cached-subtitle-key-00000001',
      settings: { type: 'openai', timeoutMs: 5_000 },
    },
    actor,
  )
  const languages = createLanguageService(database.db, async () => true)
  await database.pool.query('delete from output_language where code = $1', [
    languageCode,
  ])
  await languages.save(
    languageCode,
    {
      expectedVersion: 0,
      name: 'Test Cached',
      recognitionConfigurationId: providerId,
      translationConfigurationId: providerId,
      includeTerms: true,
    },
    actor,
  )
  await database.pool.query(
    'update output_language set enabled = true, path_validated_at = now() where code = $1',
    [languageCode],
  )
  const initial = await readSubtitlePaths(database.db, cipher, new Map())
  const cache = new Map<string, LiveSubtitlePath>(
    initial.map((item) => [item.stamp.code, item]),
  )
  const cachedRead = await readSubtitlePaths(database.db, cipher, cache)
  assert.equal(
    cachedRead.find((item) => item.stamp.code === languageCode),
    cache.get(languageCode),
    'unchanged stamps reuse cached decrypted paths without re-reading terms',
  )
  const terms = createTermService(database.db)
  const termPage = await terms.list({ query: '', offset: 0 })
  await terms.save(
    termId,
    {
      expectedVersion: 0,
      sourceTerm: `term-${actor}`,
      sourceLanguage: 'en',
      alternatives: [],
      category: 'combat',
      expressions: [{ language: 'ja', text: 'テスト' }],
      context: '',
      enabled: true,
    },
    actor,
  )
  const refreshed = await readSubtitlePaths(database.db, cipher, cache)
  const updatedPath = refreshed.find((item) => item.stamp.code === languageCode)
  assert.ok(updatedPath)
  assert.ok(
    (updatedPath.stamp.terminologyVersion ?? 0) > termPage.version,
    'term update invalidates cached subtitle paths immediately',
  )
})
