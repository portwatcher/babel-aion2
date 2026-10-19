import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { communityService } from './fixtures/community-service.mjs'
import { startTestServer } from './test-server.mjs'
import { createManagementFixture } from './management-fixture.mjs'

// Primary proof for public room admission and collaborative map persistence.
// Real HTTP and PostgreSQL detect cross-replica leakage, permission bypasses,
// duplicate writes and stale-generation access. The external-service fixture
// supplies provider responses only; it never supplies admission or DB receipts.
const database = await isolatedDatabase()
const upstream = await communityService()
const management = await createManagementFixture(database.url)
const options = {
  nodeImports: [
    './scripts/fixtures/community-network.mjs',
    './scripts/fixtures/access-jwks.mjs',
  ],
  environment: {
    ...management.environment,
    BABEL_TEST_COMMUNITY_ORIGIN: upstream.origin,
    NUXT_DISCORD_CLIENT_ID: '100000000000000020',
    NUXT_DISCORD_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    NUXT_DISCORD_BOT_TOKEN: randomBytes(32).toString('base64url'),
  },
}
let a
let b
let mismatchedApplication
async function call(
  server,
  path,
  { method = 'GET', body, cookie, token, sessionId, origin = server.origin } = {},
) {
  return fetch(`${server.origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(method === 'GET' ? {} : { origin }),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'x-listener-session': sessionId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function create(name, server, allowedIds, code) {
  const response = await call(a, '/api/player/rooms/install', {
    method: 'POST',
    body: { name, server, allowedIds },
  })
  assert.equal(response.status, 200, 'installation starts')
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i)
  const url = new URL((await response.json()).url)
  assert.equal(url.origin, 'https://discord.com')
  assert.equal(url.searchParams.get('permissions'), '3146752')
  assert.equal(
    url.searchParams.get('scope'),
    'identify guilds bot applications.commands',
  )
  assert.equal(
    (
      await call(a, '/api/player/rooms', {
        method: 'POST',
        cookie,
        body: { voiceChannelId: upstream.channel },
      })
    ).status,
    401,
    'installation cannot be skipped',
  )
  const callback = `/api/discord/callback?code=${code}&state=${url.searchParams.get('state')}`
  assert.equal(
    (await call(a, callback)).headers.get('location'),
    '/rooms/create?installationError=1',
    'callback requires original browser',
  )
  const forged = await call(a, `/api/discord/callback?code=${code}&state=forged`, {
    cookie,
  })
  assert.equal(forged.headers.get('location'), '/rooms/create?installationError=1')
  assert.equal(
    (await call(a, callback, { cookie })).headers.get('location'),
    '/rooms/create?installed=1',
  )
  assert.equal(
    (await call(a, callback, { cookie })).headers.get('location'),
    '/rooms/create?installationError=1',
    'callback is one use',
  )
  const installation = await (
    await call(a, '/api/player/rooms/installation', { cookie })
  ).json()
  assert.equal(installation.server, server)
  assert.deepEqual(installation.allowedIds, allowedIds)
  assert.deepEqual(
    installation.channels,
    [{ id: upstream.channel, name: '指挥频道' }],
    'channel overwrite blocks insufficient bot permissions',
  )
  assert.equal(
    (
      await call(a, '/api/player/rooms', {
        method: 'POST',
        cookie,
        body: { voiceChannelId: upstream.forbiddenChannel },
      })
    ).status,
    403,
  )
  const created = await call(a, '/api/player/rooms', {
    method: 'POST',
    cookie,
    body: { voiceChannelId: upstream.channel },
  })
  if (created.status === 409) {
    return { conflict: true }
  }
  assert.equal(created.status, 200)
  const result = await created.json()
  assert.deepEqual(
    await (
      await call(b, '/api/player/rooms', {
        method: 'POST',
        cookie,
        body: { voiceChannelId: upstream.channel },
      })
    ).json(),
    result,
    'creation retry is idempotent across replicas',
  )
  return result
}
async function join(roomId, nickname, expected = 202) {
  const token = randomBytes(32).toString('base64url')
  const body = { nickname, outputLanguage: null, requestId: randomUUID() }
  const response = await call(a, `/api/player/rooms/${roomId}/sessions`, {
    method: 'POST',
    token,
    body,
  })
  assert.equal(response.status, expected, `entry status: ${nickname}`)
  return { ...(await response.json()), token, body }
}
function map(server, roomId, listener, method = 'GET', body, suffix = '') {
  return call(server, `/api/player/rooms/${roomId}/map${suffix}`, {
    method,
    body,
    token: listener.token,
    sessionId: listener.sessionId,
  })
}
try {
  a = await startTestServer(database.url, options)
  b = await startTestServer(database.url, options)
  mismatchedApplication = await startTestServer(database.url, {
    ...options,
    environment: {
      ...options.environment,
      NUXT_DISCORD_CLIENT_ID: '100000000000000021',
    },
  })
  const mismatchStart = await call(mismatchedApplication, '/api/player/rooms/install', {
    method: 'POST',
    body: { name: 'Mismatched application', server: 'siel' },
  })
  assert.equal(mismatchStart.status, 200)
  const mismatchCookie = mismatchStart.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const mismatchUrl = new URL((await mismatchStart.json()).url)
  assert.equal(
    (
      await call(
        mismatchedApplication,
        `/api/discord/callback?code=gamma&state=${mismatchUrl.searchParams.get('state')}`,
        { cookie: mismatchCookie },
      )
    ).headers.get('location'),
    '/rooms/create?installed=1',
  )
  assert.equal(
    (
      await call(mismatchedApplication, '/api/player/rooms', {
        method: 'POST',
        cookie: mismatchCookie,
        body: { voiceChannelId: upstream.channel },
      })
    ).status,
    503,
    'a bot from a different application cannot complete installation',
  )
  await mismatchedApplication.close()
  for (const body of [
    { name: 'No realm' },
    { name: 'Unknown realm', server: 'invented' },
  ]) {
    assert.equal(
      (await call(a, '/api/player/rooms/install', { method: 'POST', body })).status,
      400,
    )
  }
  assert.equal(
    (
      await call(a, '/api/player/rooms/install', {
        method: 'POST',
        body: { name: 'Cross origin', server: 'siel' },
        origin: 'https://attacker.example',
      })
    ).status,
    403,
  )
  for (const tile of ['8_0_0.jpg', '1_2_0.jpg', '0_0_1.jpg', 'https.jpg']) {
    assert.equal((await call(a, `/api/player/map-tiles/${tile}`)).status, 400)
  }
  const first = await create('第一战术室', 'siel', [], 'alpha')
  const second = await create('第二战术室', 'nezekan', ['Pilot'], 'beta')
  assert.equal((await create('Duplicate guild', 'siel', [], 'alpha')).conflict, true)
  const administrator = await management.signIn(a)
  async function manage(path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${a.origin}${path}`, {
      method,
      headers: {
        'cf-access-jwt-assertion': administrator.jwt,
        cookie: administrator.cookie,
        origin: a.origin,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.equal(response.status, 200, 'authenticated room management')
    return response.json()
  }
  const selected = await manage(`/api/management/room?roomId=${second.roomId}`)
  assert.equal(selected.room.id, second.roomId)
  await manage(`/api/management/room/stop?roomId=${second.roomId}`, {
    expectedVersion: selected.room.version,
  })
  const unchanged = await manage(`/api/management/room?roomId=${first.roomId}`)
  assert.equal(
    unchanged.room.stopped,
    false,
    'stopping selected room leaves another room running',
  )
  assert.equal(
    (await manage(`/api/management/room?roomId=${second.roomId}`)).room.stopped,
    true,
  )
  const directory = await (await call(b, '/api/player/rooms')).json()
  assert.equal(directory.rooms.length, 2)
  const config = await (
    await call(b, `/api/player/rooms/${second.roomId}/config`)
  ).json()
  assert.deepEqual(config.admission, { server: 'nezekan', restricted: true })
  assert.equal(
    'allowedIds' in config.admission,
    false,
    'public configuration does not expose the allowlist',
  )
  assert.deepEqual(config.outputLanguages, [])
  await join(second.roomId, 'Scout', 403)
  for (const id of ['NotIndexed', 'OtherRealm', 'OtherRegion', 'CaseOnly']) {
    await join(first.roomId, id, 404)
  }
  await join(first.roomId, 'SchemaFailure', 503)
  await join(first.roomId, 'Unavailable', 503)
  const pilot = await join(first.roomId, 'Pilot')
  const scout = await join(first.roomId, 'Scout')
  const remotePilot = await join(second.roomId, 'Pilot')
  const stillPresent = await (
    await call(a, `/api/player/sessions/${pilot.sessionId}`, { token: pilot.token })
  ).json()
  assert.equal(
    stillPresent.state,
    'JOINING',
    'same display name in another room is independent',
  )
  assert.equal(remotePilot.nickname, 'Pilot')
  const replay = await call(b, `/api/player/rooms/${first.roomId}/sessions`, {
    method: 'POST',
    token: pilot.token,
    body: pilot.body,
  })
  assert.equal((await replay.json()).sessionId, pilot.sessionId)
  const stroke = {
    id: randomUUID(),
    color: '#fbbf24',
    points: [
      [100, 200],
      [400, 600],
    ],
    nickname: 'forged',
  }
  assert.equal((await map(a, first.roomId, scout, 'POST', stroke)).status, 200)
  assert.equal((await map(b, first.roomId, scout, 'POST', stroke)).status, 200)
  const drawing = (await (await map(b, first.roomId, pilot)).json()).strokes
  assert.equal(drawing.length, 1, 'retry never duplicates a stroke')
  assert.equal(drawing[0].nickname, 'Scout', 'author comes from authenticated session')
  assert.deepEqual(
    drawing[0].points,
    stroke.points,
    'world coordinates survive storage',
  )
  assert.deepEqual(
    (await (await map(b, second.roomId, remotePilot)).json()).strokes,
    [],
  )
  assert.equal((await map(b, second.roomId, scout)).status, 403)
  assert.equal(
    (await map(b, first.roomId, pilot, 'POST', stroke)).status,
    409,
    'another author cannot adopt a stroke ID',
  )
  assert.equal(
    (
      await map(b, first.roomId, scout, 'POST', {
        ...stroke,
        id: randomUUID(),
        points: [
          [0, 0],
          [4097, 1],
        ],
      })
    ).status,
    400,
  )
  await map(b, first.roomId, pilot, 'DELETE', undefined, `/${stroke.id}`)
  assert.equal(
    (await (await map(a, first.roomId, scout)).json()).strokes.length,
    1,
    'members cannot erase each other',
  )
  await map(a, first.roomId, scout, 'DELETE', undefined, `/${stroke.id}`)
  assert.deepEqual(
    (await (await map(b, first.roomId, pilot)).json()).strokes,
    [],
    'erasure propagates across replicas',
  )
  const ownStroke = { ...stroke, id: randomUUID() }
  await map(a, first.roomId, pilot, 'POST', ownStroke)
  const replacement = await join(first.roomId, 'Pilot')
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal(
      (
        await map(
          b,
          first.roomId,
          pilot,
          method,
          method === 'POST' ? { ...stroke, id: randomUUID() } : undefined,
          method === 'DELETE' ? `/${ownStroke.id}` : '',
        )
      ).status,
      403,
      `replaced member cannot ${method} map`,
    )
  }
  assert.equal(
    (await (await map(b, first.roomId, replacement)).json()).strokes[0].nickname,
    'Pilot',
  )
  await a.close()
  a = await startTestServer(database.url, options)
  assert.equal(
    (await (await map(a, first.roomId, scout)).json()).strokes[0].id,
    ownStroke.id,
    'drawings persist through runtime restart',
  )
  const stored = (
    await database.pool.query(
      'select encrypted_discord_credential from room where id=$1',
      [first.roomId],
    )
  ).rows[0]
  assert.ok(stored.encrypted_discord_credential)
  assert.ok(
    !stored.encrypted_discord_credential.includes(
      options.environment.NUXT_DISCORD_BOT_TOKEN,
    ),
  )
  const legacy = await manage('/api/management/room')
  await manage(
    '/api/management/room',
    {
      expectedVersion: legacy.room.version,
      name: '原有指挥室',
      guildId: '100000000000000003',
      voiceChannelId: upstream.channel,
      captureMode: 'ALL_CHANNEL',
      commanderIds: [],
      credential: options.environment.NUXT_DISCORD_BOT_TOKEN,
    },
    'PATCH',
  )
  const oldToken = randomBytes(32).toString('base64url')
  const oldEntry = await call(a, '/api/player/sessions', {
    method: 'POST',
    token: oldToken,
    body: { nickname: 'OldListener', outputLanguage: null, requestId: randomUUID() },
  })
  assert.equal(oldEntry.status, 202)
  const oldSession = await oldEntry.json()
  assert.equal(
    (
      await call(a, '/api/management/room/admission', {
        method: 'POST',
        body: { server: 'siel' },
      })
    ).status,
    401,
    'publication requires administrator Access',
  )
  await manage('/api/management/room/admission', {
    server: 'siel',
    allowedIds: ['Solo'],
  })
  const publishedDirectory = await (await call(b, '/api/player/rooms')).json()
  assert.equal(
    publishedDirectory.rooms.find((room) => room.id === legacy.room.id).server,
    'siel',
  )
  const oldSnapshot = await (
    await call(a, `/api/player/sessions/${oldSession.sessionId}`, { token: oldToken })
  ).json()
  assert.equal(
    oldSnapshot.state,
    'REMOVED',
    'publication ends unverified legacy sessions',
  )
  const forbiddenLegacy = await call(a, '/api/player/sessions', {
    method: 'POST',
    token: randomBytes(32).toString('base64url'),
    body: { nickname: 'Scout', outputLanguage: null, requestId: randomUUID() },
  })
  assert.equal(
    forbiddenLegacy.status,
    403,
    'legacy entry cannot bypass the new admission policy',
  )
  const verifiedLegacy = await call(a, '/api/player/sessions', {
    method: 'POST',
    token: randomBytes(32).toString('base64url'),
    body: { nickname: 'Solo', outputLanguage: null, requestId: randomUUID() },
  })
  assert.equal(verifiedLegacy.status, 202)
  assert.equal((await verifiedLegacy.json()).nickname, 'Solo')
  await manage('/api/management/room/admission', {
    server: 'siel',
    allowedIds: ['Solo'],
  })
  console.log(
    'PASS multi-room HTTP + PostgreSQL: required realm, OAuth state/browser binding, bot/channel permissions, optional ID allowlist, API admission, independent sessions, cross-replica strokes and erasure, replacement fencing and restart persistence.',
  )
} finally {
  await Promise.allSettled([a?.close(), b?.close(), mismatchedApplication?.close()])
  await upstream.close()
  await database.close()
}
