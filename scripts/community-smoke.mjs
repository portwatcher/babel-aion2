import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { communityService } from './fixtures/community-service.mjs'
import { call, map } from './fixtures/community-client.mjs'
import { startTestServer } from './test-server.mjs'
import { createManagementFixture } from './management-fixture.mjs'
import { verifyRoomDisband } from './fixtures/room-lifecycle.mjs'

// Primary proof for public room admission and collaborative map persistence.
// Real HTTP and PostgreSQL detect cross-replica leakage, permission bypasses,
// duplicate writes and stale-generation access. The external-service fixture
// supplies provider responses only; it never supplies admission or DB receipts.
const database = await isolatedDatabase()
const upstream = await communityService()
const management = await createManagementFixture(database.url, { legacyRoom: false })
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
async function create(name, server, allowedIds, code, shared = false) {
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
  assert.equal(
    installation.roomId,
    null,
    'a fresh installation creates a fresh room, including the same guild',
  )
  assert.equal(installation.server, server)
  assert.deepEqual(installation.allowedIds, allowedIds)
  assert.deepEqual(
    installation.channels,
    shared
      ? [{ id: upstream.channel, name: '指挥频道' }]
      : [
          { id: upstream.channel, name: '指挥频道' },
          { id: upstream.alternateChannel, name: '备用频道' },
        ],
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
  if (shared) {
    assert.equal(
      (
        await call(a, '/api/player/rooms', {
          method: 'POST',
          cookie,
          body: { voiceChannelId: upstream.alternateChannel },
        })
      ).status,
      409,
      'another room cannot move the guild receiver to a different channel',
    )
  }
  const created = await call(a, '/api/player/rooms', {
    method: 'POST',
    cookie,
    body: { voiceChannelId: upstream.channel },
  })
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
  assert.equal(
    (await (await call(b, '/api/player/rooms/installation', { cookie })).json())
      .roomNumber,
    result.roomNumber,
    'resuming a completed installation uses the same public number',
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
  await call(a, '/api/player/config')
  const emptyAdmin = await management.signIn(a)
  assert.equal(
    (
      await fetch(`${a.origin}/api/management/status?roomId=${randomUUID()}`, {
        headers: {
          'cf-access-jwt-assertion': emptyAdmin.jwt,
          cookie: emptyAdmin.cookie,
        },
      })
    ).status,
    200,
  )
  assert.equal(
    Number((await database.pool.query('select count(*) from room')).rows[0].count),
    0,
    'player and administrator reads never seed a hard-coded room',
  )
  const first = await create('第一战术室', 'siel', [], 'alpha')
  const second = await create('第二战术室', 'nezekan', ['Pilot'], 'beta')
  const sibling = await create(
    'Same Discord, independent room',
    'nezekan',
    ['Pilot'],
    'alpha',
    true,
  )
  assert.deepEqual(
    [first.roomNumber, second.roomNumber, sibling.roomNumber],
    [1, 2, 3],
    'public room numbers start at one and increase across installations',
  )
  assert.notEqual(sibling.roomId, first.roomId)
  assert.notEqual(sibling.roomId, second.roomId)
  const localizedVerification = await fetch(
    `${a.origin}/rooms/${first.roomNumber}/verify`,
    {
      headers: { 'accept-language': 'ja-JP' },
    },
  )
  assert.equal(
    localizedVerification.status,
    200,
    'direct room links have a dedicated character verification page',
  )
  const verificationHtml = await localizedVerification.text()
  assert.ok(
    verificationHtml.includes('ゲームのキャラクター ID'),
    'verification is translated during SSR',
  )
  assert.ok(
    !verificationHtml.includes('id="tactical-title"'),
    'verification does not mount the room map',
  )
  const localizedRoom = await fetch(`${a.origin}/rooms/${first.roomNumber}`, {
    headers: { 'accept-language': 'ja-JP' },
  })
  assert.equal(localizedRoom.status, 200)
  const roomHtml = await localizedRoom.text()
  assert.ok(
    !roomHtml.includes('id="nickname"'),
    'the room no longer embeds the verification form',
  )
  assert.ok(
    !roomHtml.includes('id="tactical-title"'),
    'room content waits for session restoration',
  )
  const administrator = await management.signIn(a)
  async function manage(path, body, method = body ? 'POST' : 'GET', expected = 200) {
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
    assert.equal(response.status, expected, 'authenticated room management')
    return response.json()
  }
  const localizedAdmin = await fetch(`${a.origin}/admin?roomId=${second.roomId}`, {
    headers: {
      'cf-access-jwt-assertion': administrator.jwt,
      cookie: `${administrator.cookie}; babel-interface-locale=ko`,
      'accept-language': 'ja-JP',
    },
  })
  assert.equal(localizedAdmin.status, 200)
  const adminHtml = await localizedAdmin.text()
  assert.match(adminHtml, /<html[^>]*lang="en"/)
  assert.ok(adminHtml.includes('Website administration'))
  const selected = await manage(`/api/management/room?roomId=${second.roomId}`)
  for (const fields of [
    { guildId: '100000000000000099' },
    { voiceChannelId: upstream.alternateChannel },
    { credential: randomBytes(32).toString('base64url') },
  ]) {
    await manage(
      `/api/management/room?roomId=${second.roomId}`,
      {
        expectedVersion: selected.room.version,
        name: selected.room.name,
        guildId: selected.room.guildId,
        voiceChannelId: selected.room.voiceChannelId,
        captureMode: selected.room.captureMode,
        commanderIds: selected.room.commanderIds,
        ...fields,
      },
      'PATCH',
      400,
    )
  }
  assert.equal(
    (await manage(`/api/management/room?roomId=${second.roomId}`)).room.version,
    selected.room.version,
    'management cannot reassign an installed Discord source',
  )
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
  assert.equal(directory.rooms.length, 3)
  assert.deepEqual(
    directory.rooms.map((room) => room.number),
    [1, 2, 3],
  )
  const directoryHtml = await (await call(a, '/')).text()
  assert.ok(directoryHtml.includes('href="/rooms/1"'))
  assert.ok(!directoryHtml.includes(`href="/rooms/${first.roomId}"`))
  for (const invalid of ['0', '01', '1e0', '2147483648', first.roomId]) {
    assert.equal(
      (await call(a, `/api/player/rooms/${invalid}/config`)).status,
      400,
      'only canonical positive room numbers are public addresses',
    )
  }
  assert.equal((await call(a, '/api/player/rooms/999/config')).status, 404)
  const config = await (
    await call(b, `/api/player/rooms/${second.roomNumber}/config`)
  ).json()
  assert.deepEqual(config.admission, { server: 'nezekan', restricted: true })
  assert.equal(
    'allowedIds' in config.admission,
    false,
    'public configuration does not expose the allowlist',
  )
  assert.deepEqual(config.outputLanguages, [])
  await join(second.roomNumber, 'Scout', 403)
  for (const id of ['NotIndexed', 'OtherRealm', 'OtherRegion', 'CaseOnly']) {
    await join(first.roomNumber, id, 404)
  }
  await join(first.roomNumber, 'SchemaFailure', 503)
  await join(first.roomNumber, 'Unavailable', 503)
  const pilot = await join(first.roomNumber, 'Pilot')
  const scout = await join(first.roomNumber, 'Scout')
  const remotePilot = await join(second.roomNumber, 'Pilot')
  const siblingPilot = await join(sibling.roomNumber, 'Pilot')
  assert.notEqual(siblingPilot.sessionId, pilot.sessionId)
  assert.equal(
    (
      await (
        await call(a, `/api/player/sessions/${pilot.sessionId}`, { token: pilot.token })
      ).json()
    ).state,
    'JOINING',
    'same-guild rooms retain independent nickname sessions',
  )
  const stillPresent = await (
    await call(a, `/api/player/sessions/${pilot.sessionId}`, { token: pilot.token })
  ).json()
  assert.equal(
    stillPresent.state,
    'JOINING',
    'same display name in another room is independent',
  )
  assert.equal(remotePilot.nickname, 'Pilot')
  const replay = await call(b, `/api/player/rooms/${first.roomNumber}/sessions`, {
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
  assert.equal((await map(a, first.roomNumber, scout, 'POST', stroke)).status, 200)
  assert.equal((await map(b, first.roomNumber, scout, 'POST', stroke)).status, 200)
  const drawing = (await (await map(b, first.roomNumber, pilot)).json()).strokes
  assert.equal(drawing.length, 1, 'retry never duplicates a stroke')
  assert.equal(drawing[0].nickname, 'Scout', 'author comes from authenticated session')
  assert.deepEqual(
    drawing[0].points,
    stroke.points,
    'world coordinates survive storage',
  )
  assert.deepEqual(
    (await (await map(b, second.roomNumber, remotePilot)).json()).strokes,
    [],
  )
  assert.equal((await map(b, second.roomNumber, scout)).status, 403)
  assert.equal(
    (await map(b, first.roomNumber, pilot, 'POST', stroke)).status,
    409,
    'another author cannot adopt a stroke ID',
  )
  assert.equal(
    (
      await map(b, first.roomNumber, scout, 'POST', {
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
  await map(b, first.roomNumber, pilot, 'DELETE', undefined, `/${stroke.id}`)
  assert.equal(
    (await (await map(a, first.roomNumber, scout)).json()).strokes.length,
    1,
    'members cannot erase each other',
  )
  await map(a, first.roomNumber, scout, 'DELETE', undefined, `/${stroke.id}`)
  assert.deepEqual(
    (await (await map(b, first.roomNumber, pilot)).json()).strokes,
    [],
    'erasure propagates across replicas',
  )
  const ownStroke = { ...stroke, id: randomUUID() }
  await map(a, first.roomNumber, pilot, 'POST', ownStroke)
  const replacement = await join(first.roomNumber, 'Pilot')
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal(
      (
        await map(
          b,
          first.roomNumber,
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
    (await (await map(b, first.roomNumber, replacement)).json()).strokes[0].nickname,
    'Pilot',
  )
  await a.close()
  a = await startTestServer(database.url, options)
  assert.equal(
    (await (await map(a, first.roomNumber, scout)).json()).strokes[0].id,
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
  await seedLegacyRoom(database.url)
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
  await verifyRoomDisband({
    database,
    create,
    call,
    a,
    b,
    administrator,
  })
  console.log(
    'PASS multi-room HTTP + PostgreSQL: repeated same-guild installations create independent rooms, no implicit room seeding, required realm, OAuth state/browser binding, bot/channel permissions, optional ID allowlist, API admission, independent sessions, cross-replica strokes and erasure, replacement fencing and restart persistence.',
  )
} finally {
  await Promise.allSettled([a?.close(), b?.close(), mismatchedApplication?.close()])
  await upstream.close()
  await database.close()
}
