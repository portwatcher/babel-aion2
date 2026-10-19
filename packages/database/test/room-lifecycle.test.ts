import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'
import { createListenerService } from '../src/listeners/index.ts'
import { listCommunityRooms } from '../src/community-rooms.ts'
import { readVoiceSourceGroups } from '../src/voice-sources.ts'
import { publishExistingRoom } from '../src/room-publication.ts'
import { readRoomSettings, startRoom } from '../src/room-settings.ts'
import { room, nickname } from '../src/schema/rooms.ts'
import { communityRoom } from '../src/schema/room-community.ts'
import { controlledDelivery } from './listener-fixture.ts'

// Primary lifecycle proof: real PostgreSQL, normal entry/removal and reconciler.
// Backdating stored events exercises the fixed five-minute policy without a
// production clock override. Held transport receipts guard fail-closed removal.
test('empty community rooms disband after five minutes, safely across replicas and entry races', async () => {
  assert.ok(process.env.DATABASE_URL)
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const databaseName = `babel_idle_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${databaseName}`)
  url.pathname = `/${databaseName}`
  const database = createDatabase(url.toString())
  const replica = createDatabase(url.toString())
  const transport = controlledDelivery()
  const service = createListenerService(database.db, transport.delivery)
  const otherService = createListenerService(replica.db, transport.delivery)
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    })
    async function create(name: string, age: string, published = true) {
      const id = randomUUID()
      await database.db.insert(room).values({
        id,
        name,
        stopped: false,
        discordGuildId: '100000000000000020',
        discordVoiceChannelId: '100000000000000030',
        captureMode: 'ALL_CHANNEL',
        encryptedDiscordCredential: 'fixture-unused',
      })
      if (published) {
        await database.db.insert(communityRoom).values({
          roomId: id,
          guildId: '100000000000000020',
          creatorId: '100000000000000040',
          server: 'siel',
        })
      }
      await database.pool.query(
        'update room set created_at=now()-$2::interval where id=$1',
        [id, age],
      )
      await database.pool.query(
        'update community_room set created_at=now()-$2::interval where room_id=$1',
        [id, age],
      )
      return id
    }
    async function join(id: string, name = 'Pilot') {
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
    const empty = await create('Never joined', '11 minutes')
    const fresh = await create('Not yet five minutes', '4 minutes 50 seconds')
    const occupied = await create('Occupied sibling', '10 minutes')
    const waiting = await create('Joining counts as occupied', '10 minutes')
    const recentlyLeft = await create('Recently left', '10 minutes')
    const draining = await create('Unconfirmed delivery', '10 minutes')
    const oldLeave = await create('Last left over five minutes ago', '10 minutes')
    const legacy = await create('Unpublished legacy', '10 minutes', false)
    await join(occupied)
    const waitingListener = await join(waiting)
    await database.pool.query(
      "update listener_session set state='JOINING' where id=$1",
      [waitingListener.sessionId],
    )
    transport.delivery.ready = async () => false
    const recent = await join(recentlyLeft)
    await service.leave(recent.sessionId, recent.credential)
    const held = await join(draining)
    transport.heldMedia.add(held.sessionId)
    await service.leave(held.sessionId, held.credential)
    const old = await join(oldLeave)
    await service.leave(old.sessionId, old.credential)
    await database.pool.query(
      `update listener_session set joined_at=now()-interval '10 minutes',
       revoked_at=case when revoked_at is not null then now()-interval '6 minutes' end,
       delivery_stopped_at=case when delivery_stopped_at is not null then now()-interval '5 minutes 1 second' end
       where room_id in ($1,$2,$3,$4)`,
      [occupied, waiting, draining, oldLeave],
    )
    await Promise.all([
      service.reconcile(new Date(0)),
      otherService.reconcile(new Date(0)),
    ])
    const { rows: records } = await database.pool.query<{
      id: string
      stopped: boolean
    }>('select id, stopped from room')
    assert.equal(
      records.find((r) => r.id === empty)?.stopped,
      true,
      'unused room must automatically stop after five minutes',
    )
    const visible = (await listCommunityRooms(database.db)).map((r) => r.id)
    assert.deepEqual(
      new Set(visible),
      new Set([fresh, occupied, waiting, recentlyLeft, draining]),
    )
    assert.equal(records.find((r) => r.id === legacy)?.stopped, false)
    const { rows: audits } = await database.pool.query<{ resource_id: string }>(
      "select resource_id from audit_event where action='room.disband'",
    )
    assert.deepEqual(
      audits.map((r) => r.resource_id).sort(),
      [empty, oldLeave].sort(),
      'replicas record one disband per room',
    )
    const group = (await readVoiceSourceGroups(database.db))[0]
    assert.equal(
      group?.configuration.id,
      empty,
      'the original shared source remains stable',
    )
    assert.equal(
      group?.configuration.stopped,
      false,
      'shared guild receiver continues for occupied sibling',
    )
    assert.equal(group?.rooms.find((r) => r.id === empty)?.stopped, true)
    await assert.rejects(join(empty), { code: 'ROOM_NOT_FOUND' })
    await assert.rejects(readRoomSettings(database.db, empty), { code: 'NOT_FOUND' })
    await assert.rejects(startRoom(database.db, empty, 1, 'test:idle', null), {
      code: 'NOT_FOUND',
    })

    // Even a long-idle room can be saved by an entry that already holds the
    // shared room lock while waiting for its nickname generation transaction.
    const racing = await create('Entry wins', '10 minutes')
    const key = `room:${racing}:Racer`
    await database.db.insert(nickname).values({ key })
    const holder = await database.pool.connect()
    await holder.query('begin')
    await holder.query('select key from nickname where key=$1 for update', [key])
    const {
      rows: [identity],
    } = await holder.query<{ pid: number }>('select pg_backend_pid() as pid')
    assert.ok(identity)
    const entering = join(racing, 'Racer')
    let entryFailure: unknown
    void entering.catch((error: unknown) => {
      entryFailure = error
    })
    try {
      let blocked = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const { rows } = await database.pool.query(
          'select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))',
          [identity.pid],
        )
        if (rows.length) {
          blocked = true
          break
        }
        await delay(10)
      }
      assert.equal(
        blocked,
        true,
        `entry must be in flight holding the room lock: ${String(entryFailure)}`,
      )
      await otherService.reconcile(new Date(0))
    } finally {
      await holder.query('commit')
      holder.release()
    }
    const racer = await entering
    await service.leave(racer.sessionId, racer.credential)
    await service.reconcile(new Date(0))
    assert.ok(
      (await listCommunityRooms(database.db)).some((r) => r.id === racing),
      'leaving starts a new five-minute window',
    )
    transport.heldMedia.delete(held.sessionId)
    await service.reconcile(new Date(0))
    assert.ok(
      (await listCommunityRooms(database.db)).some((r) => r.id === draining),
      'confirmed shutdown starts a full grace window',
    )
    await publishExistingRoom(database.db, legacy, { server: 'siel' }, 'test:idle')
    await service.reconcile(new Date(0))
    assert.ok(
      (await listCommunityRooms(database.db)).some((r) => r.id === legacy),
      'publishing an old room starts a new initial grace window',
    )
  } finally {
    await Promise.all([database.close(), replica.close()])
    await administrator.pool.query(`drop database ${databaseName}`)
    await administrator.close()
  }
})
