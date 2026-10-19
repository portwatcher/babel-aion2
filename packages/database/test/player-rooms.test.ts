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
