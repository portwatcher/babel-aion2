import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.ts'
import { createCredentialCipher } from '../src/credentials.ts'
import { publishExistingRoom } from '../src/room-publication.ts'
import { createListenerService } from '../src/listeners/index.ts'
import { room } from '../src/schema/rooms.ts'
import { controlledDelivery } from './listener-fixture.ts'

// The HTTP suite cannot hold real transport readiness at the publication
// boundary. This coordinator test independently guards the namespace change:
// a new scoped generation must wait for unconfirmed legacy media shutdown.
test('publishing a legacy room fences in-flight unverified entry and waits for old delivery', async () => {
  assert.ok(process.env.DATABASE_URL)
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const administrator = createDatabase(url.toString())
  const databaseName = `babel_publication_${randomUUID().replaceAll('-', '')}`
  await administrator.pool.query(`create database ${databaseName}`)
  url.pathname = `/${databaseName}`
  const database = createDatabase(url.toString())
  const id = randomUUID()
  const name = `publication-${randomUUID().slice(0, 8)}`
  const transport = controlledDelivery()
  const service = createListenerService(database.db, transport.delivery)
  const cipher = createCredentialCipher(randomBytes(32).toString('base64'))
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    })
    await database.db.insert(room).values({
      id,
      name,
      discordGuildId: (
        100000000000000000n + BigInt(`0x${randomBytes(6).toString('hex')}`)
      ).toString(),
      discordVoiceChannelId: '100000000000000030',
      encryptedDiscordCredential: cipher.encrypt('fixture-token', `room:${id}:discord`),
    })
    const entry = () => ({
      nickname: name,
      outputLanguage: null,
      requestId: randomUUID(),
    })
    const first = await service.enter(
      id,
      entry(),
      randomBytes(32).toString('base64url'),
    )
    assert.equal(first.state, 'ACTIVE')
    transport.heldMedia.add(first.sessionId)
    async function blockedBy(pid: number) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const { rows } = await database.pool.query<{ pid: number }>(
          'select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        )
        if (rows[0]) {
          return rows[0].pid
        }
        await delay(10)
      }
      throw new Error('Expected publication/entry lock contention')
    }
    const holder = await database.pool.connect()
    await holder.query('begin')
    await holder.query('select key from nickname where key=$1 for update', [name])
    const {
      rows: [identity],
    } = await holder.query<{ pid: number }>('select pg_backend_pid() as pid')
    assert.ok(identity)
    const publishing = publishExistingRoom(
      database.db,
      id,
      { server: 'siel', allowedIds: [name] },
      'test:publication',
    )
    void publishing.catch(() => {})
    let entering: ReturnType<typeof service.enter> | undefined
    try {
      const publisher = await blockedBy(identity.pid)
      entering = service.enter(id, entry(), randomBytes(32).toString('base64url'))
      void entering.catch(() => {})
      await blockedBy(publisher)
    } finally {
      await holder.query('commit')
      holder.release()
    }
    const references = await publishing
    assert.deepEqual(references, [
      { sessionId: first.sessionId, nicknameGeneration: first.nicknameGeneration },
    ])
    assert.ok(entering)
    await assert.rejects(entering, { code: 'CHARACTER_CHECK_REQUIRED' })
    const credential = randomBytes(32).toString('base64url')
    const request = entry()
    const current = await service.enter(id, request, credential, {
      nickname: name,
      server: 'siel',
      region: 'as',
      profileUrl: `https://aion2index.com/c/as/siel/${name}`,
      description: 'Fixture',
    })
    assert.equal(
      current.state,
      'JOINING',
      'scope change cannot skip old transport receipts',
    )
    await service.reconcile(new Date(0))
    assert.equal(
      (await service.restore(current.sessionId, credential)).state,
      'JOINING',
    )
    transport.heldMedia.delete(first.sessionId)
    await service.reconcile(new Date(0))
    assert.equal((await service.restore(current.sessionId, credential)).state, 'ACTIVE')
  } finally {
    await database.close()
    await administrator.pool.query(`drop database ${databaseName}`)
    await administrator.close()
  }
})
