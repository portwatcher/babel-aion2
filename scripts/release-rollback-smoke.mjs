import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createManagementFixture } from './management-fixture.mjs'
import { storageDigest } from './fixtures/database-digest.mjs'
import { releaseImages } from './fixtures/release-images.mjs'

test('published web images upgrade, roll back and upgrade again without losing newer configuration or administrator access', async (t) => {
  const previous = process.env.BABEL_ROLLBACK_PREVIOUS_IMAGE
  const current = process.env.BABEL_ROLLBACK_CURRENT_IMAGE
  const fixture = await releaseImages(previous, current)
  t.after(() => fixture.close())
  const identity = await createManagementFixture(fixture.url)
  const botCredential = `local-rollback-${randomBytes(24).toString('hex')}`
  let auth
  async function api(path, method = 'GET', body, status = 200, headers = {}) {
    const response = await fetch(fixture.origin + path, {
      method,
      headers: {
        origin: fixture.origin,
        cookie: auth?.cookie ?? '',
        'cf-access-jwt-assertion': await identity.assertion(),
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    assert.equal(response.status, status, path)
    const text = await response.text()
    assert.equal(text.includes(botCredential), false)
    return JSON.parse(text)
  }
  async function access() {
    assert.equal(
      (await api('/api/management/status')).administrator.email.endsWith(
        '@example.test',
      ),
      true,
    )
    await api('/api/management/status', 'GET', undefined, 401, { cookie: '' })
    await api('/api/management/status', 'GET', undefined, 401, {
      'cf-access-jwt-assertion': '',
    })
    await api('/api/management/status', 'GET', undefined, 403, {
      'cf-access-jwt-assertion': 'not.a.valid.jwt',
    })
    assert.equal((await fetch(fixture.origin)).status, 200)
  }
  const migrationCount = async () =>
    (
      await fixture.pool.query(
        'select count(*)::int as count from drizzle.__drizzle_migrations',
      )
    ).rows[0].count
  await fixture.migrate(previous)
  const beforeMigrations = await migrationCount()
  await fixture.start(previous, identity.environment)
  auth = await identity.signIn(fixture)
  await access()
  const previousEntry = (await api('/api/player/config')).entryAvailable
  await fixture.stop()

  await fixture.migrate(current)
  const afterMigrations = await migrationCount()
  assert.ok(afterMigrations >= beforeMigrations)
  await fixture.start(current, identity.environment)
  await access()
  const initial = (await api('/api/management/room')).room
  const roomInput = {
    expectedVersion: initial.version,
    name: '镜像回滚演练',
    guildId: '10000000000000001',
    voiceChannelId: '10000000000000002',
    captureMode: 'ALL_CHANNEL',
    commanderIds: [],
    credential: botCredential,
    removeCredential: false,
  }
  const configured = await api('/api/management/room', 'PATCH', roomInput)
  assert.equal(configured.stopped, true)
  await api(`/api/management/terms/${randomUUID()}`, 'PUT', {
    expectedVersion: 0,
    sourceTerm: 'Rollback fixture',
    sourceLanguage: 'en',
    alternatives: ['Rollback alias'],
    category: 'Synthetic test',
    context: 'Not actual game terminology.',
    enabled: true,
    expressions: [{ language: 'ja', text: '復旧テスト' }],
  })
  const saved = new Map()
  for (const path of ['/room', '/terms', '/providers', '/languages']) {
    saved.set(path, await api(`/api/management${path}`))
  }
  await fixture.stop()
  assert.equal(
    (
      await fixture.pool.query(
        'select count(*)::int as count from runtime_owner where exited_at is null',
      )
    ).rows[0].count,
    0,
  )
  // Each real start/exit legitimately adds an owner. Business and migration
  // records must survive unchanged, including fields unknown to the old image.
  const snapshot = () =>
    storageDigest(fixture.pool, {
      excludeTables: ['public.runtime_owner'],
    })
  const beforeRollback = await snapshot()
  await fixture.migrate(previous)
  assert.deepEqual(await snapshot(), beforeRollback)
  await fixture.start(previous, identity.environment)
  await access()
  assert.equal((await api('/api/player/config')).entryAvailable, previousEntry)
  await fixture.stop()
  assert.deepEqual(await snapshot(), beforeRollback)

  await fixture.migrate(current)
  assert.deepEqual(await snapshot(), beforeRollback)
  assert.equal(await migrationCount(), afterMigrations)
  await fixture.start(current, identity.environment)
  await access()
  for (const [path, value] of saved) {
    assert.deepEqual(await api(`/api/management${path}`), value)
  }
  const retained = await api('/api/management/room', 'PATCH', {
    ...roomInput,
    credential: undefined,
    expectedVersion: configured.version,
  })
  assert.equal(retained.credentialConfigured, true)
  assert.equal(retained.stopped, true)
  await fixture.stop()
  assert.equal(
    (
      await fixture.pool.query(
        'select count(*)::int as count from runtime_owner where exited_at is null',
      )
    ).rows[0].count,
    0,
  )
  const role = (
    await fixture.pool.query(
      'select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user',
    )
  ).rows[0]
  assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false })
  t.diagnostic(
    JSON.stringify({
      previous: fixture.images.get(previous),
      current: fixture.images.get(current),
      beforeMigrations,
      afterMigrations,
      preservedTables: Object.keys(beforeRollback).length,
      postgresVersion: (await fixture.pool.query('show server_version')).rows[0]
        .server_version,
    }),
  )
})
