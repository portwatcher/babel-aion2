import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createManagementFixture } from './management-fixture.mjs'

const identity = await createManagementFixture(process.env.DATABASE_URL)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const servers = []
const ids = []
const freshId = () => {
  const id = randomUUID()
  ids.push(id)
  return id
}
async function start() {
  const server = await identity.start()
  servers.push(server)
  return server
}
async function call(server, auth, path, method = 'GET', body, headers = {}) {
  return fetch(`${server.origin}/api/management/terms${path}`, {
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
async function value(response, status = 200) {
  assert.equal(response.status, status)
  return response.json()
}
const entry = {
  expectedVersion: 0,
  sourceTerm: '  Cafe\u0301 Fixture  ',
  sourceLanguage: 'en',
  alternatives: [' Fixture Alias '],
  category: 'Local fixture',
  context: 'Synthetic terminology, not confirmed game vocabulary.',
  enabled: true,
  expressions: [
    { language: 'ja', text: '<b>試験語</b>' },
    { language: 'zh-Hans', text: '测试词' },
    { language: 'zh-Hant', text: '測試詞' },
  ],
}
try {
  const first = await start()
  const second = await start()
  const auth = await identity.signIn(first)
  const id = freshId()
  assert.equal((await fetch(`${first.origin}/api/management/terms`)).status, 401)
  for (const [headers, status] of [
    [{ cookie: '' }, 401],
    [{ 'cf-access-jwt-assertion': 'forged' }, 403],
    [{ origin: 'https://attacker.example' }, 403],
  ]) {
    assert.equal(
      (await call(first, auth, `/${id}`, 'PUT', entry, headers)).status,
      status,
    )
  }
  const initial = await value(await call(first, auth, ''))
  assert.deepEqual(initial.items, [], 'No assumed release terms are seeded')
  for (const input of [
    { ...entry, sourceLanguage: 'und' },
    { ...entry, sourceTerm: 'bad\u200bterm' },
    { ...entry, alternatives: ['Café Fixture'] },
    {
      ...entry,
      expressions: [
        { language: 'ja', text: 'one' },
        { language: 'ja', text: 'two' },
      ],
    },
    { ...entry, sourceTerm: 'x'.repeat(121) },
    { ...entry, credential: 'not-a-term-field' },
  ]) {
    assert.equal((await call(first, auth, `/${id}`, 'PUT', input)).status, 400)
  }
  const created = await value(await call(first, auth, `/${id}`, 'PUT', entry))
  assert.equal(created.sourceTerm, 'Café Fixture')
  assert.deepEqual(created.alternatives, ['Fixture Alias'])
  assert.deepEqual(created.expressions, entry.expressions)
  assert.equal(created.version, initial.version + 1)
  const duplicate = await value(
    await call(second, auth, `/${freshId()}`, 'PUT', {
      ...entry,
      sourceTerm: 'fixture alias',
      alternatives: [],
    }),
    409,
  )
  assert.equal(duplicate.data.code, 'DUPLICATE_TERM')
  const raceIds = [freshId(), freshId()]
  const race = await Promise.all(
    raceIds.map((raceId, index) =>
      call(index ? second : first, auth, `/${raceId}`, 'PUT', {
        ...entry,
        sourceTerm: index ? 'Race é Fixture' : 'Race e\u0301 Fixture',
        alternatives: [],
      }),
    ),
  )
  assert.deepEqual(
    race.map((response) => response.status).sort(),
    [200, 409],
    'Canonical duplicate creation is serialized across processes',
  )
  const edits = await Promise.all(
    [first, second].map((server, index) =>
      call(server, auth, `/${id}`, 'PUT', {
        ...entry,
        expectedVersion: created.version,
        context: `revision-${index}`,
        enabled: false,
      }),
    ),
  )
  assert.deepEqual(edits.map((response) => response.status).sort(), [200, 409])
  const accepted = await value(edits.find((response) => response.status === 200))
  assert.ok(accepted.version > created.version)
  await first.close()
  const restarted = await start()
  const reloaded = await value(await call(restarted, auth, '?query=Caf%C3%A9'))
  assert.deepEqual(
    reloaded.items,
    [accepted],
    'Restart preserves accepted term fields, versions and disabled state',
  )
  await value(
    await call(second, auth, `/${id}`, 'DELETE', { expectedVersion: created.version }),
    409,
  )
  await value(
    await call(second, auth, `/${id}`, 'DELETE', { expectedVersion: accepted.version }),
  )
  const recreated = await value(await call(second, auth, `/${id}`, 'PUT', entry))
  assert.ok(
    recreated.version > accepted.version,
    'Recreated IDs cannot reuse an old version',
  )
  await value(
    await call(restarted, auth, `/${id}`, 'PUT', {
      ...entry,
      expectedVersion: accepted.version,
    }),
    409,
  )

  const pageIds = []
  for (let index = 0; index < 52; index += 1) {
    const pageId = freshId()
    pageIds.push(pageId)
    await value(
      await call(second, auth, `/${pageId}`, 'PUT', {
        ...entry,
        sourceTerm: `PaginationFixture${String(index).padStart(2, '0')}`,
        alternatives: [],
      }),
    )
  }
  const pageOne = await value(await call(second, auth, '?query=PaginationFixture'))
  assert.equal(pageOne.items.length, 50)
  assert.equal(pageOne.nextOffset, 50)
  const pageTwo = await value(
    await call(
      second,
      auth,
      `?query=PaginationFixture&offset=50&expectedVersion=${pageOne.version}`,
    ),
  )
  assert.equal(pageTwo.items.length, 2)
  assert.equal(pageTwo.nextOffset, null)
  assert.deepEqual(
    new Set([...pageOne.items, ...pageTwo.items].map((term) => term.id)),
    new Set(pageIds),
  )
  const changed = pageOne.items[0]
  await value(
    await call(second, auth, `/${changed.id}`, 'PUT', {
      sourceTerm: changed.sourceTerm,
      sourceLanguage: changed.sourceLanguage,
      alternatives: changed.alternatives,
      category: changed.category,
      expressions: changed.expressions,
      context: 'newer page snapshot',
      enabled: changed.enabled,
      expectedVersion: changed.version,
    }),
  )
  await value(
    await call(
      restarted,
      auth,
      `?query=PaginationFixture&offset=50&expectedVersion=${pageOne.version}`,
    ),
    409,
  )
  const percentId = freshId()
  await value(
    await call(second, auth, `/${percentId}`, 'PUT', {
      ...entry,
      sourceTerm: 'Percent%Fixture',
      alternatives: [],
    }),
  )
  const percent = await value(await call(second, auth, '?query=%25'))
  assert.deepEqual(
    percent.items.map((term) => term.id),
    [percentId],
    'Search treats SQL wildcard characters literally',
  )
  const audits = (
    await pool.query(
      "select action, metadata from audit_event where actor_subject = $1 and action like 'term.%'",
      [identity.actor],
    )
  ).rows
  assert.ok(audits.some((row) => row.action === 'term.remove'))
  assert.ok(
    audits.every(
      (row) =>
        Object.keys(row.metadata).sort().join(',') ===
        (row.action === 'term.save'
          ? 'catalogVersion,enabled,version'
          : 'catalogVersion,version'),
    ),
  )
  const auditText = JSON.stringify(audits)
  for (const privateText of [
    'Café Fixture',
    'Fixture Alias',
    '<b>試験語</b>',
    'newer page snapshot',
  ]) {
    assert.equal(auditText.includes(privateText), false)
  }
  const publicConfiguration = await (
    await fetch(`${second.origin}/api/player/config`)
  ).json()
  assert.deepEqual(publicConfiguration.outputLanguages, [])
  assert.equal(JSON.stringify(publicConfiguration).includes('Café Fixture'), false)
  console.log(
    'PASS term catalog HTTP + PostgreSQL: Access/session/origin guards, canonical fields, alias conflicts and concurrent versions, restart, deletion/recreation fencing, versioned pagination, literal search and content-free audits. All vocabulary is local test data.',
  )
} finally {
  await Promise.all(servers.map((server) => server.close()))
  await pool.query('delete from game_term where id = any($1::uuid[])', [ids])
  await pool.query("update term_catalog set version = version + 1 where id = 'global'")
  await pool.query('delete from audit_event where actor_subject = $1', [identity.actor])
  await pool.query('delete from auth_user where id = $1', [identity.actor])
  await pool.end()
}
