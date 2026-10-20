import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { inArray } from 'drizzle-orm'
import { createDatabase } from '../src/client.ts'
import { createPlayerRoom, listCommunityRooms } from '../src/community-rooms.ts'
import { stopRoom, startRoom, readRoomSettings } from '../src/room-settings.ts'
import { auditEvent, room } from '../src/schema/rooms.ts'
import { voiceSourceRun } from '../src/schema/voice-sources.ts'
import { runtimeOwner } from '../src/schema/runtime-owners.ts'
import { registerRuntimeOwner } from '../src/runtime-owners.ts'
import {
  claimVoiceSource,
  readUplinkHost,
  readVoiceSourceGroups,
  voiceSourceConfigured,
} from '../src/voice-sources.ts'

test('player-source rooms need no Discord, own their source per room and expose the host only while running', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'Use disposable PostgreSQL')
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const database = createDatabase(url.toString(), { queryTimeoutMs: 2_000 })
  const suffix = randomUUID().slice(0, 12)
  const ids: string[] = []
  const ownerId = randomUUID()
  const leases: Awaited<ReturnType<typeof claimVoiceSource>>[] = []
  t.after(async () => {
    try {
      await Promise.all(leases.map((lease) => lease.abandon()))
      if (ids.length) {
        await database.db
          .delete(voiceSourceRun)
          .where(inArray(voiceSourceRun.roomId, ids))
        await database.db.delete(auditEvent).where(inArray(auditEvent.resourceId, ids))
        await database.db.delete(room).where(inArray(room.id, ids))
      }
      await database.db.delete(runtimeOwner).where(inArray(runtimeOwner.id, [ownerId]))
    } finally {
      await database.close()
    }
  })
  await registerRuntimeOwner(database.db, ownerId)
  await assert.rejects(
    createPlayerRoom(database.db, { name: 'no host', server: 'siel', allowedIds: [] }),
  )
  for (const index of [0, 1]) {
    const created = await createPlayerRoom(database.db, {
      name: `player-${suffix}-${index}`,
      server: 'siel',
      allowedIds: [],
      hostId: ` host-${suffix}-${index} `,
    })
    ids.push(created.roomId)
  }
  const [first, second] = ids as [string, string]
  const listed = (await listCommunityRooms(database.db)).filter((item) =>
    ids.includes(item.id),
  )
  assert.equal(listed.length, 2)
  assert.ok(listed.every((item) => !item.stopped && !item.restricted))

  const groups = (await readVoiceSourceGroups(database.db)).filter((group) =>
    ids.includes(group.configuration.id),
  )
  assert.equal(groups.length, 2, 'player rooms never share a guild source')
  for (const group of groups) {
    assert.equal(group.rooms.length, 1)
    assert.ok(voiceSourceConfigured(group.configuration))
    assert.equal(group.configuration.encryptedDiscordCredential, null)
  }
  assert.equal(await readUplinkHost(database.db, first), `host-${suffix}-0`)

  // Ownership is exclusive per room, so both rooms run concurrently.
  for (const group of groups) {
    leases.push(
      await claimVoiceSource(
        database.db,
        database.pool,
        group.configuration,
        null,
        ownerId,
        () => {},
      ),
    )
  }
  assert.ok(leases.every((lease) => lease.valid()))
  await Promise.all(leases.map((lease) => lease.close()))

  const settings = await readRoomSettings(database.db, second)
  await stopRoom(database.db, second, settings.version, 'player-room-test')
  assert.equal(await readUplinkHost(database.db, second), null)
  const restarted = await startRoom(
    database.db,
    second,
    (await readRoomSettings(database.db, second)).version,
    'player-room-test',
    null,
  )
  assert.equal(restarted.stopped, false, 'starting needs no Discord credential')
  assert.equal(await readUplinkHost(database.db, second), `host-${suffix}-1`)
})

test('a worker with a two-connection pool controls five rooms at once and loses them together', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'Use disposable PostgreSQL')
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  // The production worker budget: two connections per pool.
  const database = createDatabase(url.toString(), {
    queryTimeoutMs: 2_000,
    maxConnections: 2,
  })
  const suffix = randomUUID().slice(0, 12)
  const ids: string[] = []
  const ownerId = randomUUID()
  const leases: Awaited<ReturnType<typeof claimVoiceSource>>[] = []
  t.after(async () => {
    try {
      await Promise.all(leases.map((lease) => lease.abandon()))
      if (ids.length) {
        await database.db
          .delete(voiceSourceRun)
          .where(inArray(voiceSourceRun.roomId, ids))
        await database.db.delete(auditEvent).where(inArray(auditEvent.resourceId, ids))
        await database.db.delete(room).where(inArray(room.id, ids))
      }
      await database.db.delete(runtimeOwner).where(inArray(runtimeOwner.id, [ownerId]))
    } finally {
      await database.close()
    }
  })
  await registerRuntimeOwner(database.db, ownerId)
  for (const index of [0, 1, 2, 3, 4]) {
    const created = await createPlayerRoom(database.db, {
      name: `pool-${suffix}-${index}`,
      server: 'siel',
      allowedIds: [],
      hostId: `pool-host-${suffix}-${index}`,
    })
    ids.push(created.roomId)
  }
  const groups = (await readVoiceSourceGroups(database.db)).filter((group) =>
    ids.includes(group.configuration.id),
  )
  assert.equal(groups.length, 5)
  const lost = new Set<string>()
  const claims = await Promise.all(
    groups.map((group) =>
      claimVoiceSource(
        database.db,
        database.pool,
        group.configuration,
        null,
        ownerId,
        () => lost.add(group.configuration.id),
      ),
    ),
  )
  leases.push(...claims)
  assert.ok(claims.every((lease) => lease.valid()))
  // Ordinary queries still have a connection while every source is held.
  assert.equal(await readUplinkHost(database.db, ids[0]!), `pool-host-${suffix}-0`)
  await assert.rejects(
    claimVoiceSource(
      database.db,
      database.pool,
      groups[0]!.configuration,
      null,
      ownerId,
      () => {},
    ),
    'a held room cannot be claimed twice in the same process',
  )
  const holders = await database.pool.query<{ pid: number }>(
    `select l.pid from pg_locks l
     join pg_stat_activity a on a.pid = l.pid and a.datname = current_database()
     where l.locktype = 'advisory' and l.granted
     group by l.pid having count(*) >= 5`,
  )
  assert.equal(holders.rows.length, 1, 'one session holds every source lock')
  await database.pool.query('select pg_terminate_backend($1)', [holders.rows[0]!.pid])
  const deadline = Date.now() + 3_000
  while (lost.size < 5 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(lost.size, 5, 'losing the session invalidates every source')
  assert.ok(claims.every((lease) => !lease.valid()))
})
