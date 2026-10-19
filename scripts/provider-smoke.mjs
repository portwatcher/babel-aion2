import assert from 'node:assert/strict'
import { createDecipheriv, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'
import { createManagementFixture } from './management-fixture.mjs'
import { createProviderFixture } from './fixtures/provider-server.mjs'

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, 'Use the disposable local database')
const identity = await createManagementFixture(databaseUrl)
const network = await createProviderFixture()
const pool = new Pool({ connectionString: databaseUrl })
const servers = []
const id = randomUUID()
const otherId = randomUUID()
const path = `/api/management/providers/${id}`
const language = `x-fixture-${randomUUID()}`
const credential = network.credential()
const replacement = network.credential()
const invalid = network.credential('invalid')
const settings = {
  type: 'openai',
  timeoutMs: 5_000,
}

async function start(overrides = {}) {
  const server = await identity.start(
    { BABEL_TEST_PROVIDER_ORIGIN: network.origin, ...overrides },
    ['./scripts/fixtures/provider-network.mjs'],
  )
  servers.push(server)
  return server
}
async function request(server, auth, url, method = 'GET', body, headers = {}) {
  return fetch(`${server.origin}${url}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      origin: server.origin,
      cookie: auth.cookie,
      'cf-access-jwt-assertion': auth.jwt,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function stored() {
  return (await pool.query('select * from provider_configuration where id = $1', [id]))
    .rows[0]
}
async function pastCooldown() {
  // Establish a previous test's persisted start time; do not replace application clocks.
  await pool.query(
    "update provider_configuration set last_test_started_at = now() - interval '1 minute' where id = $1",
    [id],
  )
}
function decrypt(envelope) {
  const [format, iv, payload, tag] = envelope.split('.')
  assert.equal(format, 'v1')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    identity.key,
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAAD(Buffer.from(`babel:credential:v1:provider:${id}:credential`))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64url')),
    decipher.final(),
  ]).toString()
}
function input(current, changes = {}) {
  return {
    expectedVersion: current.version,
    name: current.name,
    settings: current.settings,
    ...changes,
  }
}
async function result(response, status = 200) {
  assert.equal(response.status, status)
  const text = await response.text()
  for (const key of [credential, replacement, invalid]) {
    assert.equal(
      text.includes(key),
      false,
      'Never echo credentials or unsafe upstream details',
    )
  }
  return JSON.parse(text)
}

try {
  const server = await start()
  const auth = await identity.signIn(server)
  const draft = { expectedVersion: 0, name: '翻译候选', settings, credential }
  for (const [url, method, body] of [
    ['/api/management/providers', 'GET'],
    [path, 'PUT', draft],
    [path, 'DELETE', { expectedVersion: 1 }],
    [`${path}/test`, 'POST', { expectedVersion: 1 }],
    [`${path}/restore`, 'POST', { expectedVersion: 1, restoreVersion: 1 }],
  ]) {
    assert.equal((await fetch(`${server.origin}${url}`, { method })).status, 401)
    assert.equal(
      (await request(server, auth, url, method, body, { cookie: '' })).status,
      401,
    )
    assert.equal(
      (
        await request(server, auth, url, method, body, {
          'cf-access-jwt-assertion': 'forged',
        })
      ).status,
      403,
    )
    if (method !== 'GET') {
      assert.equal(
        (
          await request(server, auth, url, method, body, {
            origin: 'https://attacker.example',
          })
        ).status,
        403,
      )
    }
  }
  assert.equal(
    (await request(server, auth, path, 'PUT', { ...draft, enabled: true })).status,
    400,
  )
  assert.equal(
    (
      await request(server, auth, path, 'PUT', {
        ...draft,
        settings: { ...settings, endpoint: network.origin },
      })
    ).status,
    400,
  )
  const unprotected = await start({ NUXT_PROVIDER_ENCRYPTION_KEY: '' })
  assert.equal((await request(unprotected, auth, path, 'PUT', draft)).status, 503)
  await unprotected.close()
  const races = await Promise.all([
    request(server, auth, path, 'PUT', draft),
    request(server, auth, path, 'PUT', draft),
  ])
  assert.deepEqual(races.map((response) => response.status).sort(), [200, 409])
  let current = await result(races.find((response) => response.status === 200))
  assert.equal(current.enabled, false)
  assert.equal(current.credentialConfigured, true)
  assert.equal(current.lastTest, null)
  assert.equal(decrypt((await stored()).encrypted_credential) === credential, true)
  assert.equal(
    network.observations.length,
    0,
    'Creating a draft must not spend a provider request',
  )
  current = await result(
    await request(server, auth, `${path}/test`, 'POST', {
      expectedVersion: current.version,
    }),
  )
  assert.equal(current.lastTest.code, 'PASS')
  assert.equal(current.lastTest.configurationVersion, current.version)
  assert.equal(
    (
      await request(server, auth, `${path}/test`, 'POST', {
        expectedVersion: current.version,
      })
    ).status,
    429,
  )
  await pastCooldown()
  const beforeFailure = await stored()
  const failed = await result(
    await request(server, auth, path, 'PUT', input(current, { credential: invalid })),
    422,
  )
  assert.equal(failed.data.testCode, 'INVALID_CREDENTIAL')
  assert.equal(
    (await stored()).encrypted_credential,
    beforeFailure.encrypted_credential,
  )
  assert.equal((await stored()).version, current.version)
  await pastCooldown()
  current = await result(
    await request(
      server,
      auth,
      path,
      'PUT',
      input(current, { credential: replacement, name: '替换后的候选' }),
    ),
  )
  assert.equal(current.version, 2)
  assert.equal(current.lastTest.code, 'PASS')
  assert.equal(decrypt((await stored()).encrypted_credential) === replacement, true)
  const revision = (
    await pool.query(
      'select * from provider_revision where configuration_id = $1 and version = 1',
      [id],
    )
  ).rows[0]
  assert.equal(decrypt(revision.encrypted_credential) === credential, true)
  assert.deepEqual(
    current.history.map((item) => item.version),
    [1],
  )
  assert.equal(
    (await request(server, auth, path, 'PUT', input(current, { expectedVersion: 1 })))
      .status,
    409,
  )
  assert.equal(
    (
      await request(
        server,
        auth,
        path,
        'PUT',
        input(current, {
          settings: { type: 'unsupported', timeoutMs: 5_000 },
        }),
      )
    ).status,
    400,
  )

  // A second server shares the database lease. A late first response must not
  // overwrite a newer configuration after its persisted lease has expired.
  await pastCooldown()
  const second = await start()
  const hold = network.hold(replacement, 'translation', true)
  const pending = request(server, auth, `${path}/test`, 'POST', {
    expectedVersion: current.version,
  })
  await Promise.race([
    hold.started,
    setTimeout(3_000).then(() => {
      throw new Error('Provider request did not reach fixture')
    }),
  ])
  assert.equal(
    (
      await request(second, auth, `${path}/test`, 'POST', {
        expectedVersion: current.version,
      })
    ).status,
    409,
  )
  assert.equal(
    (await request(second, auth, path, 'DELETE', { expectedVersion: current.version }))
      .status,
    409,
  )
  assert.equal(
    (await request(second, auth, path, 'PUT', input(current, { name: '测试期间修改' })))
      .status,
    409,
  )
  await pool.query(
    "update provider_configuration set test_lease_until = now() - interval '1 second' where id = $1",
    [id],
  )
  current = await result(
    await request(second, auth, path, 'PUT', input(current, { name: '新版本' })),
  )
  const accepted = await stored()
  hold.release()
  assert.equal((await pending).status, 409)
  assert.deepEqual((await stored()).last_test, accepted.last_test)
  assert.equal((await stored()).version, current.version)
  await pastCooldown()
  current = await result(
    await request(second, auth, `${path}/restore`, 'POST', {
      expectedVersion: current.version,
      restoreVersion: 1,
    }),
  )
  assert.equal(current.version, 4)
  assert.equal(current.name, draft.name)
  assert.equal(decrypt((await stored()).encrypted_credential) === credential, true)
  network.setMode(replacement, 'quota')
  await pastCooldown()
  const failedRestore = await result(
    await request(second, auth, `${path}/restore`, 'POST', {
      expectedVersion: current.version,
      restoreVersion: 2,
    }),
    422,
  )
  assert.equal(failedRestore.data.testCode, 'QUOTA_EXHAUSTED')
  assert.equal((await stored()).version, current.version)

  await result(
    await request(second, auth, `/api/management/providers/${otherId}`, 'PUT', {
      ...draft,
      name: '独立配置',
    }),
  )
  const correctEnvelope = (await stored()).encrypted_credential
  await pool.query(
    'update provider_configuration set encrypted_credential = (select encrypted_credential from provider_configuration where id = $1) where id = $2',
    [otherId, id],
  )
  assert.equal(
    (
      await request(second, auth, `${path}/test`, 'POST', {
        expectedVersion: current.version,
      })
    ).status,
    503,
  )
  await pool.query(
    'update provider_configuration set encrypted_credential = $1 where id = $2',
    [correctEnvelope, id],
  )
  await server.close()
  await second.close()
  const restarted = await start()
  const listing = await result(
    await request(restarted, auth, '/api/management/providers'),
  )
  const restored = listing.configurations.find((item) => item.id === id)
  assert.deepEqual(
    restored,
    current,
    'Configurations and history survive a new server process',
  )
  assert.equal(JSON.stringify(listing).includes(correctEnvelope), false)
  const publicText = await (await fetch(`${restarted.origin}/api/player/config`)).text()
  assert.equal(publicText.includes(id), false)
  assert.deepEqual(JSON.parse(publicText).outputLanguages, [])
  await pool.query(
    'insert into output_language (code, name, enabled, translation_configuration_id) values ($1, $2, false, $3)',
    [language, '引用测试', id],
  )
  assert.equal(
    (
      await request(restarted, auth, path, 'DELETE', {
        expectedVersion: current.version,
      })
    ).status,
    409,
  )
  await pool.query('delete from output_language where code = $1', [language])
  assert.equal(
    (
      await request(restarted, auth, path, 'DELETE', {
        expectedVersion: current.version,
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await pool.query('select * from provider_revision where configuration_id = $1', [
        id,
      ])
    ).rowCount,
    0,
  )
  const audits = (
    await pool.query(
      'select action, metadata from audit_event where actor_subject = $1',
      [identity.actor],
    )
  ).rows
  assert.ok(
    audits.some(
      (row) =>
        row.action === 'provider.test' && row.metadata.code === 'QUOTA_EXHAUSTED',
    ),
  )
  assert.ok(audits.some((row) => row.action === 'provider.remove'))
  for (const key of [credential, replacement, invalid, correctEnvelope]) {
    assert.equal(JSON.stringify(audits).includes(key), false)
  }
  console.log(
    'PASS provider management HTTP + PostgreSQL: Access/session/origin guards, encrypted history, failed replacement/restore preservation, cross-process leases, stale-result fencing, restart, references and redacted reads/audits. Provider responses are local fixtures; live availability/quality not tested.',
  )
} finally {
  await network.close()
  await Promise.all(servers.map((server) => server.close()))
  await pool.query('delete from output_language where code = $1', [language])
  await pool.query('delete from provider_configuration where id = any($1::uuid[])', [
    [id, otherId],
  ])
  await pool.query('delete from audit_event where actor_subject = $1', [identity.actor])
  await pool.query('delete from auth_user where id = $1', [identity.actor])
  await pool.end()
}
