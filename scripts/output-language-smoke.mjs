import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'
import { createManagementFixture } from './management-fixture.mjs'
import { createProviderFixture } from './fixtures/provider-server.mjs'
import { syntheticWave } from './fixtures/audio-sample.mjs'

// This suite owns persisted language configuration and validation at the built
// HTTP boundary. Provider protocol/quality contracts belong to their own suites.
const identity = await createManagementFixture(process.env.DATABASE_URL)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const network = await createProviderFixture()
const servers = []
const codes = ['zh-Hant', 'ja']
const recognitionId = randomUUID()
const translationId = randomUUID()
const termId = randomUUID()
const recognitionKey = network.credential('speech')
const translationKey = network.credential()
const audioBase64 = syntheticWave().toString('base64')
const entry = {
  expectedVersion: 0,
  name: '繁体中文样本',
  recognitionConfigurationId: recognitionId,
  translationConfigurationId: translationId,
  includeTerms: true,
}
const prefix = '/api/management/languages'

async function start() {
  const server = await identity.start({ BABEL_TEST_PROVIDER_ORIGIN: network.origin }, [
    './scripts/fixtures/provider-network.mjs',
  ])
  servers.push(server)
  return server
}
async function request(server, auth, route, method = 'GET', body, headers = {}) {
  return fetch(`${server.origin}${route}`, {
    method,
    signal: AbortSignal.timeout(15_000),
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
async function value(response, status = 200) {
  assert.equal(response.status, status)
  const text = await response.text()
  assert.equal(text.includes(recognitionKey) || text.includes(translationKey), false)
  return JSON.parse(text)
}
async function pastCooldown() {
  await pool.query(
    "update provider_configuration set last_test_started_at = now() - interval '1 minute' where id = any($1::uuid[])",
    [[recognitionId, translationId]],
  )
}
async function waitForTranslation(hold) {
  await Promise.race([
    hold.started,
    setTimeout(5_000).then(() => {
      throw new Error('Sample did not reach translation')
    }),
  ])
}

try {
  const first = await start()
  const second = await start()
  const auth = await identity.signIn(first)
  const call = (route = '', method = 'GET', body, server = first) =>
    request(server, auth, `${prefix}${route}`, method, body)
  const list = () => call().then(value)
  const sample = (language, server = first, extras = {}) =>
    call(
      `/${language.code}/validate`,
      'POST',
      {
        expectedVersion: language.version,
        audioBase64,
        ...extras,
      },
      server,
    )

  assert.equal((await fetch(`${first.origin}${prefix}`)).status, 401)
  assert.equal(
    (await fetch(`${first.origin}${prefix}/zh-Hant/validate`, { method: 'POST' }))
      .status,
    401,
  )
  for (const [headers, status] of [
    [{ cookie: '' }, 401],
    [{ 'cf-access-jwt-assertion': 'forged' }, 403],
    [{ origin: 'https://attacker.example' }, 403],
  ]) {
    await value(
      await request(first, auth, `${prefix}/zh-Hant`, 'PUT', entry, headers),
      status,
    )
  }
  assert.deepEqual((await list()).items, [], 'Migration must not seed languages')
  const recognition = {
    name: 'Language fixture recognition',
    expectedVersion: 0,
    settings: { type: 'soniox', model: 'stt-rt-v5', timeoutMs: 5_000 },
    credential: recognitionKey,
  }
  const translation = {
    name: 'Language fixture translation',
    expectedVersion: 0,
    settings: {
      type: 'deepl',
      endpoint: 'https://api-free.deepl.com',
      model: 'prefer_quality_optimized',
      timeoutMs: 5_000,
    },
    credential: translationKey,
  }
  for (const [id, input] of [
    [recognitionId, recognition],
    [translationId, translation],
  ]) {
    await value(
      await request(first, auth, `/api/management/providers/${id}`, 'PUT', input),
    )
  }
  for (const [code, input] of [
    ['zh-hant', entry],
    ['und', entry],
    ['ja', { ...entry, name: 'bad\u200bname' }],
    ['ja', { ...entry, name: 'x'.repeat(81) }],
    [
      'ja',
      {
        ...entry,
        recognitionConfigurationId: translationId,
        translationConfigurationId: recognitionId,
      },
    ],
    ['ja', { ...entry, recognitionConfigurationId: randomUUID() }],
    ['ja', { ...entry, enabled: true }],
  ]) {
    await value(await call(`/${code}`, 'PUT', input), 400)
  }
  await value(await call('/ja', 'PUT', { ...entry, name: 'x'.repeat(33_000) }), 413)
  let language = await value(await call('/zh-Hant', 'PUT', entry))
  assert.equal(language.code, 'zh-Hant')
  assert.equal(language.validationState, 'NOT_TESTED')
  assert.equal(language.enabled, false)
  const unproved = await value(
    await call('/zh-Hant/state', 'POST', {
      expectedVersion: language.version,
      enabled: true,
    }),
    409,
  )
  assert.equal(unproved.data.code, 'PATH_UNVALIDATED')
  const inUse = await value(
    await request(first, auth, `/api/management/providers/${recognitionId}`, 'DELETE', {
      expectedVersion: 1,
    }),
    409,
  )
  assert.equal(inUse.data.code, 'PROVIDER_IN_USE')
  await value(await sample(language, first, { outputLanguage: 'ja' }), 400)
  await value(await sample({ ...language, version: language.version + 1 }), 409)
  assert.equal(
    network.observations.length,
    0,
    'Rejected language requests cannot spend provider work',
  )

  const validated = await value(await sample(language))
  language = validated.language
  assert.equal(validated.sample.code, 'PASS')
  assert.equal(language.validationState, 'CURRENT')
  assert.equal(language.validation.recognition.id, recognitionId)
  assert.equal(language.validation.translation.id, translationId)
  assert.equal(language.validation.pathVersion, language.pathVersion)
  assert.equal(
    language.validation.terminologyVersion,
    validated.sample.terminology.version,
  )
  assert.equal(language.validation.stableUtterances, 2)
  const proof = language.validation
  const unavailable = await value(
    await call('/zh-Hant/state', 'POST', {
      expectedVersion: language.version,
      enabled: true,
    }),
    503,
  )
  assert.equal(unavailable.data.code, 'DELIVERY_UNAVAILABLE')
  const publicConfig = await (await fetch(`${first.origin}/api/player/config`)).json()
  assert.deepEqual(
    publicConfig.outputLanguages,
    [],
    'A sample does not open unimplemented player delivery',
  )

  await pastCooldown()
  network.setMode(translationKey, 'quota')
  const failed = await value(await sample(language))
  language = failed.language
  assert.equal(language.lastAttempt.code, 'QUOTA_EXHAUSTED')
  assert.deepEqual(
    language.validation,
    proof,
    'A temporary failure retains the last successful proof',
  )
  assert.equal(language.validationState, 'CURRENT')
  assert.equal(language.enabled, false)
  network.setMode(translationKey, 'pass')
  const renamed = await value(
    await call('/zh-Hant', 'PUT', {
      ...entry,
      expectedVersion: language.version,
      name: '繁體測試語言',
    }),
  )
  assert.equal(renamed.pathVersion, language.pathVersion)
  assert.deepEqual(
    renamed.validation,
    proof,
    'Display name changes preserve path evidence',
  )
  language = renamed

  await first.close()
  const restarted = await start()
  const reloaded = await value(await call('', 'GET', undefined, restarted))
  assert.deepEqual(
    reloaded.items,
    [language],
    'Restart preserves configuration and validation evidence',
  )
  const activeCall = (route = '', method = 'GET', body) =>
    call(route, method, body, restarted)
  const activeList = () => activeCall().then(value)
  const edits = await Promise.all(
    [second, restarted].map((server, index) =>
      call(
        '/zh-Hant',
        'PUT',
        { ...entry, expectedVersion: language.version, name: `Concurrent ${index}` },
        server,
      ),
    ),
  )
  assert.deepEqual(edits.map((response) => response.status).sort(), [200, 409])
  language = await value(edits.find((response) => response.status === 200))

  let japanese = await value(
    await activeCall('/ja', 'PUT', { ...entry, name: '日本語', includeTerms: false }),
  )
  let page = await activeList()
  await value(
    await activeCall('/ja/move', 'POST', {
      expectedCatalogVersion: page.version,
      direction: 'up',
    }),
  )
  const moved = await activeList()
  assert.deepEqual(
    moved.items.map((row) => row.code),
    ['ja', 'zh-Hant'],
  )
  assert.deepEqual(moved.items[1].validation, proof)
  await value(
    await activeCall('/default', 'POST', {
      expectedCatalogVersion: page.version,
      code: 'ja',
    }),
    409,
  )
  await value(
    await activeCall('/default', 'POST', {
      expectedCatalogVersion: moved.version,
      code: 'ja',
    }),
  )
  page = await activeList()
  assert.equal(page.defaultOutputLanguage, 'ja')
  japanese = page.items[0]
  language = page.items[1]

  // A provider revision invalidates the proof without erasing the prior result.
  await value(
    await request(
      restarted,
      auth,
      `/api/management/providers/${translationId}`,
      'PUT',
      {
        expectedVersion: 1,
        name: 'Renamed translation',
        settings: translation.settings,
      },
    ),
  )
  language = (await activeList()).items.find((row) => row.code === 'zh-Hant')
  assert.equal(language.validationState, 'STALE')
  assert.deepEqual(language.validation, proof)
  await pastCooldown()
  language = (await value(await sample(language, restarted))).language
  assert.equal(language.validation.translation.version, 2)
  assert.equal(language.validationState, 'CURRENT')
  const termInput = {
    expectedVersion: 0,
    sourceTerm: 'Fixture attack',
    sourceLanguage: 'en',
    alternatives: [],
    category: 'Synthetic fixture',
    context: 'Not verified game vocabulary.',
    enabled: true,
    expressions: [{ language: 'zh-Hant', text: '測試詞' }],
  }
  await value(
    await request(restarted, auth, `/api/management/terms/${termId}`, 'PUT', termInput),
  )
  language = (await activeList()).items.find((row) => row.code === 'zh-Hant')
  assert.equal(
    language.validationState,
    'STALE',
    'Terms are part of the validation snapshot',
  )
  await pastCooldown()
  japanese = (await value(await sample(japanese, restarted))).language
  assert.equal(japanese.validation.terminologyVersion, null)
  assert.equal(japanese.validationState, 'CURRENT')

  // Hold the real provider boundary while another process edits the language.
  await pastCooldown()
  const hold = network.hold(translationKey)
  const pending = sample(language, restarted)
  await waitForTranslation(hold)
  language = await value(
    await call(
      '/zh-Hant',
      'PUT',
      { ...entry, expectedVersion: language.version, includeTerms: false },
      second,
    ),
  )
  hold.release()
  const stale = await value(await pending, 409)
  assert.equal(stale.data.code, 'VERSION_CONFLICT')
  const afterRace = (await activeList()).items.find((row) => row.code === 'zh-Hant')
  assert.equal(afterRace.validation, null)
  assert.equal(
    afterRace.lastAttempt,
    null,
    'Late sample cannot stamp the replacement path',
  )
  assert.ok(afterRace.pathVersion > proof.pathVersion)

  await value(await activeCall('/ja', 'DELETE', { expectedVersion: japanese.version }))
  assert.equal((await activeList()).defaultOutputLanguage, null)
  const recreated = await value(
    await activeCall('/ja', 'PUT', { ...entry, name: 'New Japanese fixture' }),
  )
  assert.ok(recreated.version > japanese.version)
  await value(
    await activeCall('/ja', 'PUT', { ...entry, expectedVersion: japanese.version }),
    409,
  )

  // ISO 639 private-use codes isolate pagination fixtures from release choices.
  for (let index = 0; index < 51; index += 1) {
    const code = `q${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`
    codes.push(code)
    await value(
      await activeCall(`/${code}`, 'PUT', { ...entry, name: `Fixture ${index}` }),
    )
  }
  page = await activeList()
  assert.equal(page.items.length, 50)
  assert.equal(page.nextOffset, 50)
  await value(await activeCall('?offset=50'), 400)
  await value(
    await activeCall('/default', 'POST', {
      expectedCatalogVersion: page.version,
      code: 'zh-Hant',
    }),
  )
  await value(await activeCall(`?offset=50&expectedVersion=${page.version}`), 409)
  page = await activeList()
  const tail = await value(
    await activeCall(`?offset=50&expectedVersion=${page.version}`),
  )
  assert.equal(tail.items.length, 3)
  assert.equal(tail.nextOffset, null)
  assert.equal(new Set([...page.items, ...tail.items].map((row) => row.code)).size, 53)
  const remaining = [...page.items, ...tail.items]
  for (const item of remaining) {
    await value(
      await activeCall(`/${item.code}`, 'DELETE', { expectedVersion: item.version }),
    )
  }
  assert.deepEqual((await activeList()).items, [])
  assert.equal((await activeList()).defaultOutputLanguage, null)
  for (const [id, version] of [
    [recognitionId, 1],
    [translationId, 2],
  ]) {
    await value(
      await request(restarted, auth, `/api/management/providers/${id}`, 'DELETE', {
        expectedVersion: version,
      }),
    )
  }
  const audits = (
    await pool.query('select metadata from audit_event where actor_subject = $1', [
      identity.actor,
    ])
  ).rows
  const serialized = JSON.stringify(audits)
  for (const privateValue of [
    recognitionKey,
    translationKey,
    audioBase64,
    'Do not attack',
    'fixture:ZH-HANT',
  ]) {
    assert.equal(
      serialized.includes(privateValue),
      false,
      'Audit must contain metadata only',
    )
  }
  console.log(
    'PASS output-language HTTP + PostgreSQL: protected CRUD, path/provider checks, validation persistence and failure retention, version-bound proofs, fail-closed activation, concurrent edits and late samples, restart, ordering/default, ABA protection, fenced pagination, reference deletion and redacted audit. Provider responses and audio are synthetic fixtures; live delivery remains untested.',
  )
} finally {
  await network.close()
  await Promise.all(servers.map((server) => server.close()))
  await pool.query(
    'update room set default_output_language = null where default_output_language = any($1::text[])',
    [codes],
  )
  await pool.query('delete from output_language where code = any($1::text[])', [codes])
  await pool.query(
    "update language_catalog set version = version + 1 where id = 'global'",
  )
  await pool.query('delete from provider_configuration where id = any($1::uuid[])', [
    [recognitionId, translationId],
  ])
  await pool.query('delete from game_term where id = $1', [termId])
  await pool.query("update term_catalog set version = version + 1 where id = 'global'")
  await pool.query('delete from audit_event where actor_subject = $1', [identity.actor])
  await pool.query('delete from auth_user where id = $1', [identity.actor])
  await pool.end()
}
