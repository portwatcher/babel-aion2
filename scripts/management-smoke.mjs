import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { Pool } from 'pg'
import WebSocket from 'ws'
import { createManagementFixture } from './management-fixture.mjs'

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, 'Use the disposable local database')
const fixture = await createManagementFixture(databaseUrl)
const pool = new Pool({ connectionString: databaseUrl })
const servers = []
const nickname = `management-${randomUUID().slice(0, 8)}`
let original
let socket

async function start(overrides) {
  const server = await fixture.start(overrides)
  servers.push(server)
  return server
}
async function request(server, auth, path, method = 'GET', body, overrides = {}) {
  return fetch(`${server.origin}${path}`, {
    method,
    headers: {
      origin: server.origin,
      cookie: auth.cookie,
      'cf-access-jwt-assertion': auth.jwt,
      'content-type': 'application/json',
      ...overrides,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function update(room, fields = {}) {
  return {
    expectedVersion: room.version,
    name: room.name,
    guildId: room.guildId,
    voiceChannelId: room.voiceChannelId,
    captureMode: room.captureMode,
    commanderIds: room.commanderIds,
    removeCredential: false,
    ...fields,
  }
}
async function saved(roomId) {
  return (await pool.query('select * from room where id = $1', [roomId])).rows[0]
}
function sealForContext(plaintext, context) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', fixture.key, nonce)
  cipher.setAAD(Buffer.from(`babel:credential:v1:${context}`))
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return [
    'v1',
    nonce.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

try {
  const server = await start()
  const auth = await fixture.signIn(server)
  for (const path of ['/api/management/room', '/api/management/listeners']) {
    assert.equal((await fetch(`${server.origin}${path}`)).status, 401)
    assert.equal(
      (
        await request(server, auth, path, 'GET', undefined, {
          'cf-access-jwt-assertion': '',
        })
      ).status,
      401,
    )
    assert.equal(
      (await request(server, auth, path, 'GET', undefined, { cookie: '' })).status,
      401,
    )
    assert.equal(
      (
        await request(server, auth, path, 'GET', undefined, {
          'cf-access-jwt-assertion': 'forged',
        })
      ).status,
      403,
    )
  }
  const initialResponse = await request(server, auth, '/api/management/room')
  assert.equal(initialResponse.status, 200)
  const initial = await initialResponse.json()
  let current = initial.room
  original = await saved(current.id)
  assert.equal(
    original.encrypted_discord_credential,
    null,
    'Refuse to overwrite a preconfigured local room',
  )
  assert.equal(initial.credentialProtectionReady, true)
  assert.equal(current.captureMode, 'SELECTED_USERS')
  const credential = `local-fixture-${randomBytes(32).toString('hex')}`
  const input = update(current, {
    name: '管理测试房间',
    guildId: '100000000000000001',
    voiceChannelId: '100000000000000002',
    commanderIds: ['100000000000000003'],
    credential,
  })
  assert.equal(
    (
      await request(server, auth, '/api/management/room', 'PATCH', input, {
        origin: 'https://attacker.example',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await request(server, auth, '/api/management/room', 'PATCH', {
        ...input,
        enabled: true,
      })
    ).status,
    400,
  )
  const unprotected = await start({ NUXT_PROVIDER_ENCRYPTION_KEY: '' })
  assert.equal(
    (await request(unprotected, auth, '/api/management/room', 'PATCH', input)).status,
    503,
  )
  assert.equal((await saved(current.id)).configuration_version, current.version)
  await unprotected.close()

  const response = await request(server, auth, '/api/management/room', 'PATCH', input)
  assert.equal(response.status, 200)
  const responseText = await response.text()
  assert.equal(
    responseText.includes(credential),
    false,
    'Never echo a submitted credential',
  )
  current = JSON.parse(responseText)
  assert.equal(current.credentialConfigured, true)
  assert.equal(current.sourceConfigured, true)
  assert.equal(current.stopped, true)
  assert.equal(typeof current.guildId, 'string')
  assert.equal(current.version, initial.room.version + 1)
  assert.equal(current.sourceGeneration, initial.room.sourceGeneration + 1)
  let stored = await saved(current.id)
  const originalEnvelope = stored.encrypted_discord_credential
  assert.equal(originalEnvelope.includes(credential), false)
  // Independently verify the documented at-rest format using Node crypto.
  const [format, iv, payload, tag] = originalEnvelope.split('.')
  assert.equal(format, 'v1')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    fixture.key,
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAAD(Buffer.from(`babel:credential:v1:room:${current.id}:discord`))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  assert.equal(
    Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString() === credential,
    true,
  )

  const races = await Promise.all(
    ['配置 A', '配置 B'].map((name) =>
      request(server, auth, '/api/management/room', 'PATCH', update(current, { name })),
    ),
  )
  assert.deepEqual(races.map((entry) => entry.status).sort(), [200, 409])
  const winning = races.find((entry) => entry.status === 200)
  assert.ok(winning)
  current = await winning.json()
  assert.equal(current.version, initial.room.version + 2)
  assert.equal((await saved(current.id)).encrypted_discord_credential, originalEnvelope)

  const damagedTag = Buffer.from(tag, 'base64url')
  damagedTag[0] ^= 1
  for (const brokenEnvelope of [
    [format, iv, payload, damagedTag.toString('base64url')].join('.'),
    sealForContext(credential, `room:${randomUUID()}:discord`),
  ]) {
    await pool.query(
      'update room set encrypted_discord_credential = $1 where id = $2',
      [brokenEnvelope, current.id],
    )
    assert.equal(
      (
        await request(
          server,
          auth,
          '/api/management/room',
          'PATCH',
          update(current, { name: 'must-not-save' }),
        )
      ).status,
      503,
    )
    assert.equal((await saved(current.id)).configuration_version, current.version)
  }
  await pool.query('update room set encrypted_discord_credential = $1 where id = $2', [
    originalEnvelope,
    current.id,
  ])
  const wrongKey = await start({
    NUXT_PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  })
  assert.equal(
    (await request(wrongKey, auth, '/api/management/room', 'PATCH', update(current)))
      .status,
    503,
  )
  await wrongKey.close()
  const rotated = await request(
    server,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { credential }),
  )
  assert.equal(rotated.status, 200)
  current = await rotated.json()
  assert.equal(
    (await saved(current.id)).encrypted_discord_credential === originalEnvelope,
    false,
    'Replacement uses a fresh nonce',
  )

  // Seed an already-running desired state to exercise the stop transition.
  await pool.query('update room set stopped = false where id = $1', [current.id])
  const stop = await request(server, auth, '/api/management/room/stop', 'POST', {
    expectedVersion: current.version,
  })
  assert.equal(stop.status, 200)
  const stopped = await stop.json()
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.sourceGeneration, current.sourceGeneration + 1)
  current = stopped
  const stoppedAgain = await request(
    server,
    auth,
    '/api/management/room/stop',
    'POST',
    { expectedVersion: current.version },
  )
  assert.equal((await stoppedAgain.json()).version, current.version)

  // Full-channel capture needs no hard-coded speakers. Switching scope must
  // retire the old source generation even when guild/channel/credential match.
  await pool.query('update room set stopped = false where id = $1', [current.id])
  const allMembers = await request(
    server,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { captureMode: 'ALL_CHANNEL', commanderIds: [] }),
  )
  assert.equal(allMembers.status, 200)
  const all = await allMembers.json()
  assert.equal(all.captureMode, 'ALL_CHANNEL')
  assert.equal(all.sourceConfigured, true)
  assert.equal(all.stopped, true)
  assert.equal(all.sourceGeneration, current.sourceGeneration + 1)
  current = all
  assert.equal(
    (
      await request(
        server,
        auth,
        '/api/management/room',
        'PATCH',
        update(current, { captureMode: 'EVERYWHERE' }),
      )
    ).status,
    400,
  )
  const unchangedScope = await request(
    server,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { name: '频道全部成员测试' }),
  )
  assert.equal(unchangedScope.status, 200)
  const renamed = await unchangedScope.json()
  assert.equal(renamed.captureMode, 'ALL_CHANNEL')
  assert.equal(renamed.sourceGeneration, current.sourceGeneration)
  current = renamed
  const selectedAgain = await request(
    server,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { captureMode: 'SELECTED_USERS' }),
  )
  assert.equal(selectedAgain.status, 200)
  const selected = await selectedAgain.json()
  assert.equal(
    selected.sourceConfigured,
    false,
    'An empty selected list is not a source',
  )
  assert.equal(selected.sourceGeneration, current.sourceGeneration + 1)
  current = selected
  const restoreAll = await request(
    server,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { captureMode: 'ALL_CHANNEL' }),
  )
  assert.equal(restoreAll.status, 200)
  current = await restoreAll.json()

  const playerCredential = randomBytes(32).toString('base64url')
  const playerResponse = await fetch(`${server.origin}/api/player/sessions`, {
    method: 'POST',
    headers: {
      origin: server.origin,
      authorization: `Bearer ${playerCredential}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ nickname, outputLanguage: null, requestId: randomUUID() }),
  })
  assert.equal(playerResponse.status, 202)
  const player = await playerResponse.json()
  socket = new WebSocket(`${server.origin.replace('http:', 'ws:')}/api/player/ws`, {
    headers: { origin: server.origin },
  })
  const messages = []
  const closed = once(socket, 'close')
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString())
    messages.push(message)
    if (message.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', nonce: message.nonce }))
    }
  })
  await once(socket, 'open')
  const authenticated = once(socket, 'message')
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      sessionId: player.sessionId,
      credential: playerCredential,
    }),
  )
  await authenticated
  const removalPath = `/api/management/listeners/${player.sessionId}`
  assert.equal(
    (
      await request(server, auth, removalPath, 'DELETE', {
        nicknameGeneration: player.nicknameGeneration + 1,
      })
    ).status,
    404,
  )
  assert.equal(
    (
      await request(server, auth, removalPath, 'DELETE', {
        nicknameGeneration: player.nicknameGeneration,
      })
    ).status,
    200,
  )
  await closed
  assert.ok(
    messages.some(
      (message) =>
        message.type === 'session' &&
        message.session.terminalReason === 'ADMINISTRATOR_REMOVED',
    ),
  )
  const list = await (await request(server, auth, '/api/management/listeners')).json()
  assert.equal(
    list.players.find((entry) => entry.sessionId === player.sessionId).state,
    'DISCONNECTING',
  )

  await server.close()
  const restarted = await start()
  const restored = await request(restarted, auth, '/api/management/room')
  assert.equal(
    restored.status,
    200,
    'Persisted administrator cookie survives process restart',
  )
  assert.deepEqual((await restored.json()).room, current)
  const publicResponse = await fetch(`${restarted.origin}/api/player/config`)
  const publicText = await publicResponse.text()
  assert.equal(publicText.includes(credential), false)
  assert.equal(publicText.includes(input.guildId), false)
  assert.equal(JSON.parse(publicText).room.name, current.name)
  const cleared = await request(
    restarted,
    auth,
    '/api/management/room',
    'PATCH',
    update(current, { removeCredential: true }),
  )
  assert.equal(cleared.status, 200)
  assert.equal((await cleared.json()).credentialConfigured, false)
  assert.equal((await saved(current.id)).encrypted_discord_credential, null)
  const audits = (
    await pool.query(
      'select action, metadata from audit_event where actor_subject = $1',
      [fixture.actor],
    )
  ).rows
  assert.ok(audits.some((entry) => entry.action === 'listener.remove'))
  assert.ok(audits.some((entry) => entry.action === 'room.stop'))
  assert.equal(JSON.stringify(audits).includes(credential), false)
  assert.ok(
    audits
      .filter((entry) => entry.action === 'room.configure')
      .every(
        (entry) =>
          Object.keys(entry.metadata).sort().join(',') ===
          'credentialChanged,sourceGeneration,version',
      ),
  )
  console.log(
    'PASS authenticated management HTTP + PostgreSQL: encrypted credentials, tamper/context/key rejection, concurrent versions, redacted reads/audits, persistent stop, exact-generation removal and restart.',
  )
} finally {
  socket?.terminate()
  await Promise.all(servers.map((server) => server.close()))
  await pool.query('delete from audit_event where actor_subject = $1', [fixture.actor])
  await pool.query('delete from auth_user where id = $1', [fixture.actor])
  await pool.query('delete from listener_session where nickname_key = $1', [nickname])
  await pool.query('delete from nickname where key = $1', [nickname])
  if (original) {
    await pool.query(
      'update room set name=$1, stopped=$2, source_generation=$3, configuration_version=$4, discord_guild_id=$5, discord_voice_channel_id=$6, commander_ids=$7, encrypted_discord_credential=$8, updated_at=$9, capture_mode=$10 where id=$11',
      [
        original.name,
        original.stopped,
        original.source_generation,
        original.configuration_version,
        original.discord_guild_id,
        original.discord_voice_channel_id,
        JSON.stringify(original.commander_ids),
        original.encrypted_discord_credential,
        original.updated_at,
        original.capture_mode,
        original.id,
      ],
    )
  }
  await pool.end()
}
