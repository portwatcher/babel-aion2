import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'
import { createListenerService } from '../src/listeners/index.ts'
import { createPlayerRoom, listCommunityRooms } from '../src/community-rooms.ts'
import { room } from '../src/schema/rooms.ts'
import { controlledDelivery } from './listener-fixture.ts'

// Real PostgreSQL: a host close must tombstone the room and end every member
// session with ROOM_CLOSED, while only the host's current session may do it.
test('the host closes a community room for every member at once', async () => {
  assert.ok(process.env.DATABASE_URL)
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const databaseName = `babel_close_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${databaseName}`)
  url.pathname = `/${databaseName}`
  const database = createDatabase(url.toString())
  const transport = controlledDelivery()
  const service = createListenerService(database.db, transport.delivery)
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    })
    async function join(id: string, name: string) {
      const credential = randomBytes(32).toString('base64url')
      const request = { nickname: name, outputLanguage: null, requestId: randomUUID() }
      const listener = await service.enter(id, request, credential, {
        nickname: name,
        server: 'siel',
        region: 'as',
        profileUrl: `https://aion2index.com/c/as/siel/${name}`,
        description: 'Fixture',
      })
      return { ...listener, credential }
    }
    const { roomId } = await createPlayerRoom(database.db, {
      name: 'Host closes',
      server: 'siel',
      allowedIds: [],
      hostId: 'Pilot',
    })
    const { roomId: sibling } = await createPlayerRoom(database.db, {
      name: 'Untouched sibling',
      server: 'siel',
      allowedIds: [],
      hostId: 'Pilot',
    })
    const host = await join(roomId, 'Pilot')
    const guest = await join(roomId, 'Scout')
    const elsewhere = await join(sibling, 'Scout')

    await assert.rejects(service.closeRoom(guest.sessionId, guest.credential), {
      code: 'NOT_ROOM_HOST',
    })
    await assert.rejects(service.closeRoom(host.sessionId, guest.credential), {
      code: 'INVALID_CREDENTIAL',
    })
    // A replaced host session lost its authority to the newer one.
    const replacement = await join(roomId, 'Pilot')
    await assert.rejects(service.closeRoom(host.sessionId, host.credential), {
      code: 'SESSION_ENDED',
    })

    const closed = await service.closeRoom(
      replacement.sessionId,
      replacement.credential,
    )
    assert.equal(closed.state, 'REMOVED')
    assert.equal(closed.terminalReason, 'ROOM_CLOSED')
    const guestView = await service.restore(guest.sessionId, guest.credential)
    assert.equal(guestView.state, 'REMOVED')
    assert.equal(guestView.terminalReason, 'ROOM_CLOSED', 'members learn who ended it')
    assert.ok(transport.stopped.has(guest.sessionId), 'member delivery is revoked')
    assert.ok(transport.stopped.has(replacement.sessionId))

    const [stored] = await database.db.select().from(room).where(eq(room.id, roomId))
    assert.ok(stored?.disbandedAt, 'the room is tombstoned immediately')
    assert.equal(stored.stopped, true)
    const visible = (await listCommunityRooms(database.db)).map((item) => item.id)
    assert.deepEqual(visible, [sibling])
    await assert.rejects(join(roomId, 'Scout'), { code: 'ROOM_NOT_FOUND' })
    await assert.rejects(
      service.closeRoom(replacement.sessionId, replacement.credential),
      { code: 'ROOM_NOT_FOUND' },
    )
    const still = await service.restore(elsewhere.sessionId, elsewhere.credential)
    assert.equal(still.state, 'ACTIVE', 'sibling rooms keep their members')
    const { rows: audits } = await database.pool.query<{ metadata: unknown }>(
      "select metadata from audit_event where action='room.disband' and resource_id=$1",
      [roomId],
    )
    assert.deepEqual(
      audits.map((item) => item.metadata),
      [{ reason: 'HOST_CLOSED', members: 2 }],
    )
  } finally {
    await database.close()
    await administrator.pool.query(`drop database if exists ${databaseName}`)
    await administrator.close()
  }
})
