import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import WebSocket from 'ws'
import { createManagementFixture } from './management-fixture.mjs'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { storageDigest } from './fixtures/database-digest.mjs'
import {
  assertMatchingPostgresTools,
  postgresTool,
} from './fixtures/postgres-backup.mjs'
import { createProviderFixture } from './fixtures/provider-server.mjs'
import { syntheticWave } from './fixtures/audio-sample.mjs'
import { startMediaWorker, until } from './fixtures/media-worker.mjs'

test('custom-format backups restore application settings, credentials and terminal sessions while uncertain live receipts remain fail-closed', async (t) => {
  const databases = [],
    services = [],
    sockets = []
  let directory, network
  t.after(async () => {
    for (const socket of sockets) {
      socket.terminate()
    }
    await Promise.allSettled(services.map((service) => service.close()))
    await network?.close()
    for (const database of databases.reverse()) {
      await database.close()
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })
  const source = await isolatedDatabase()
  databases.push(source)
  const major = await assertMatchingPostgresTools(source)
  await mkdir('.local', { recursive: true })
  directory = await mkdtemp('.local/restore-proof-')
  const identity = await createManagementFixture(source.url)
  network = await createProviderFixture()
  const botCredential = `local-restore-${randomBytes(24).toString('hex')}`
  const recognitionKey = network.credential('speech')
  const translationKey = network.credential('speech')
  const recognitionId = randomUUID(),
    translationId = randomUUID()
  let auth
  async function start(database, key = identity.key.toString('base64')) {
    const secret = randomBytes(32).toString('base64url')
    const worker = await startMediaWorker(database.url, secret, undefined, {
      PROVIDER_ENCRYPTION_KEY: identity.key.toString('base64'),
      DATABASE_POOL_MAX: '2',
    })
    services.push(worker)
    const web = await identity.start(
      {
        NUXT_DATABASE_URL: database.url,
        NUXT_PROVIDER_ENCRYPTION_KEY: key,
        NUXT_MEDIA_CONTROL_URL: worker.origin,
        NUXT_MEDIA_CONTROL_SECRET: secret,
        BABEL_TEST_PROVIDER_ORIGIN: network.origin,
      },
      ['./scripts/fixtures/provider-network.mjs'],
    )
    services.push(web)
    return { web, worker }
  }
  async function management(
    server,
    path,
    method = 'GET',
    body,
    status = 200,
    headers = {},
  ) {
    const response = await fetch(`${server.origin}/api/management${path}`, {
      method,
      headers: {
        origin: server.origin,
        cookie: auth.cookie,
        'cf-access-jwt-assertion': await identity.assertion(),
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    assert.equal(response.status, status, path)
    const text = await response.text()
    assert.equal(
      [botCredential, recognitionKey, translationKey].some((secret) =>
        text.includes(secret),
      ),
      false,
    )
    return JSON.parse(text)
  }
  async function player(server, credential, path, method = 'GET', body) {
    return fetch(`${server.origin}/api/player${path}`, {
      method,
      headers: {
        origin: server.origin,
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }
  async function enter(
    server,
    nickname,
    credential = randomBytes(32).toString('base64url'),
  ) {
    const response = await player(server, credential, '/sessions', 'POST', {
      nickname,
      outputLanguage: null,
      requestId: randomUUID(),
    })
    assert.ok([200, 202].includes(response.status))
    return { credential, session: await response.json() }
  }
  async function capture(name) {
    const client = await source.pool.connect()
    try {
      await client.query('begin isolation level repeatable read read only')
      const snapshot = (await client.query('select pg_export_snapshot() as id')).rows[0]
        .id
      const digest = await storageDigest(client)
      const dump = await postgresTool(source.url, 'pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--snapshot=${snapshot}`,
      ])
      assert.equal(dump.subarray(0, 5).toString(), 'PGDMP')
      const path = join(directory, `${name}.dump`)
      await writeFile(path, dump, { mode: 0o600 })
      await client.query('commit')
      return { path, digest, bytes: dump.length }
    } finally {
      await client.query('rollback')
      client.release()
    }
  }
  async function restore(backup) {
    const database = await isolatedDatabase({ migrate: false })
    databases.push(database)
    assert.deepEqual(await storageDigest(database.pool), {})
    await postgresTool(
      database.url,
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--single-transaction',
        `--dbname=${new URL(database.url).pathname.slice(1)}`,
      ],
      await readFile(backup.path),
    )
    assert.deepEqual(await storageDigest(database.pool), backup.digest)
    await promisify(execFile)(
      process.execPath,
      ['packages/database/dist/migrate.mjs'],
      {
        env: { ...process.env, DATABASE_URL: database.url },
      },
    ).catch(() => {
      throw new Error('Restored migration history was not reusable')
    })
    assert.deepEqual(await storageDigest(database.pool), backup.digest)
    return database
  }
  const original = await start(source)
  auth = await identity.signIn(original.web)
  const initial = (await management(original.web, '/room')).room
  const roomInput = {
    expectedVersion: initial.version,
    name: '恢复演练',
    guildId: '10000000000000001',
    voiceChannelId: '10000000000000002',
    captureMode: 'ALL_CHANNEL',
    commanderIds: [],
    credential: botCredential,
    removeCredential: false,
  }
  const room = await management(original.web, '/room', 'PATCH', roomInput)
  assert.equal(room.stopped, true)
  const providerInputs = [
    [
      recognitionId,
      {
        name: '恢复识别候选',
        settings: { type: 'openai', timeoutMs: 5_000 },
        credential: recognitionKey,
      },
    ],
    [
      translationId,
      {
        name: '恢复翻译候选',
        settings: {
          type: 'openai',
          timeoutMs: 5_000,
        },
        credential: translationKey,
      },
    ],
  ]
  for (const [id, input] of providerInputs) {
    await management(original.web, `/providers/${id}`, 'PUT', {
      ...input,
      expectedVersion: 0,
    })
  }
  const translation = await management(
    original.web,
    `/providers/${translationId}`,
    'PUT',
    {
      expectedVersion: 1,
      name: '恢复翻译候选第二版',
      settings: providerInputs[1][1].settings,
    },
  )
  assert.equal(translation.history.length, 1)
  await management(original.web, `/terms/${randomUUID()}`, 'PUT', {
    expectedVersion: 0,
    sourceTerm: 'Restore fixture',
    sourceLanguage: 'en',
    alternatives: ['Restore alias'],
    category: 'Synthetic test',
    context: 'Not actual game terminology.',
    enabled: true,
    expressions: [{ language: 'ja', text: '復元テスト' }],
  })
  let language = await management(original.web, '/languages/ja', 'PUT', {
    expectedVersion: 0,
    name: '恢复测试语言',
    recognitionConfigurationId: recognitionId,
    translationConfigurationId: translationId,
    includeTerms: true,
  })
  const proof = await management(original.web, '/languages/ja/validate', 'POST', {
    expectedVersion: language.version,
    audioBase64: syntheticWave().toString('base64'),
  })
  assert.equal(proof.sample.code, 'PASS')
  language = proof.language
  assert.equal(language.enabled, false)
  const saved = new Map()
  for (const path of ['/room', '/providers', '/terms', '/languages']) {
    saved.set(path, await management(original.web, path))
  }
  const nickname = `restore-${randomUUID().slice(0, 10)}`
  const entry = await enter(original.web, nickname)
  assert.equal(entry.session.state, 'ACTIVE')
  const socket = new WebSocket(
    `${original.web.origin.replace('http:', 'ws:')}/api/player/ws`,
    { origin: original.web.origin },
  )
  sockets.push(socket)
  const events = []
  socket.on('message', (data) => {
    const event = JSON.parse(data.toString())
    events.push(event)
    if (event.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
    }
  })
  await once(socket, 'open')
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      sessionId: entry.session.sessionId,
      credential: entry.credential,
    }),
  )
  await until(
    () => events.some((event) => event.type === 'session'),
    'registered live player socket',
  )
  const live = await capture('live')
  const closed = once(socket, 'close')
  assert.ok(
    (
      await player(
        original.web,
        entry.credential,
        `/sessions/${entry.session.sessionId}`,
        'DELETE',
      )
    ).ok,
  )
  await closed
  await until(
    async () =>
      (
        await source.pool.query('select state from listener_session where id=$1', [
          entry.session.sessionId,
        ])
      ).rows[0].state === 'REMOVED',
    'listener leave persisted',
  )
  await original.web.close()
  await original.worker.close()
  for (const [table, column] of [
    ['player_connection', 'closed_at'],
    ['runtime_owner', 'exited_at'],
  ]) {
    assert.equal(
      (
        await source.pool.query(
          `select count(*)::int as count from ${table} where ${column} is null`,
        )
      ).rows[0].count,
      0,
    )
  }
  const stopped = await capture('stopped')

  const uncertain = await restore(live)
  const uncertainRuntime = await start(uncertain)
  const blocked = await enter(uncertainRuntime.web, nickname)
  assert.equal(blocked.session.state, 'JOINING')
  assert.equal(
    (await enter(uncertainRuntime.web, `${nickname}-other`)).session.state,
    'ACTIVE',
  )
  const unconfirmed = await uncertain.pool.query(
    'select closed_at from player_connection where session_id=$1',
    [entry.session.sessionId],
  )
  assert.equal(unconfirmed.rows.length, 1)
  assert.equal(unconfirmed.rows[0].closed_at, null)
  await uncertainRuntime.web.close()
  await uncertainRuntime.worker.close()

  const restored = await restore(stopped)
  const recovered = await start(restored)
  for (const [path, expected] of saved) {
    assert.deepEqual(await management(recovered.web, path), expected)
  }
  await management(recovered.web, '/room', 'GET', undefined, 401, {
    'cf-access-jwt-assertion': '',
  })
  assert.equal(
    (
      await player(
        recovered.web,
        entry.credential,
        `/sessions/${entry.session.sessionId}/heartbeat`,
        'POST',
      )
    ).status,
    410,
  )
  const fresh = await enter(recovered.web, nickname)
  assert.equal(fresh.session.state, 'ACTIVE')
  assert.ok(fresh.session.nicknameGeneration > entry.session.nicknameGeneration)
  const sourceStatus = await (
    await recovered.worker.control('/source', { roomId: room.id })
  ).json()
  assert.equal(sourceStatus.state, 'STOPPED')
  const retained = {
    ...roomInput,
    expectedVersion: room.version,
    credential: undefined,
    name: '恢复后保留凭据',
  }
  const wrong = await start(restored, randomBytes(32).toString('base64'))
  await management(wrong.web, '/room', 'PATCH', retained, 503)
  await wrong.web.close()
  await wrong.worker.close()
  assert.deepEqual(await management(recovered.web, '/room'), saved.get('/room'))
  const updated = await management(recovered.web, '/room', 'PATCH', retained)
  assert.equal(updated.version, room.version + 1)
  assert.equal(updated.credentialConfigured, true)
  const provider = await management(
    recovered.web,
    `/providers/${translationId}`,
    'PUT',
    {
      expectedVersion: translation.version,
      name: '恢复后保留供应商凭据',
      settings: translation.settings,
    },
  )
  assert.equal(provider.version, translation.version + 1)
  assert.equal(provider.credentialConfigured, true)
  t.diagnostic(
    `PostgreSQL ${major}; exact restore of ${Object.keys(stopped.digest).length} tables; live/stopped custom dumps ${live.bytes}/${stopped.bytes} bytes; no production data or live provider quality claimed.`,
  )
})
