import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'
import { createManagementFixture } from './management-fixture.mjs'
import { createProviderFixture } from './fixtures/provider-server.mjs'
import { syntheticWave } from './fixtures/audio-sample.mjs'

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, 'Use the disposable local database')
const identity = await createManagementFixture(databaseUrl)
const network = await createProviderFixture()
const pool = new Pool({ connectionString: databaseUrl })
const servers = []
const recognitionId = randomUUID()
const translationId = randomUUID()
const recognitionKey = network.credential('speech')
const translationKey = network.credential()
const wave = syntheticWave()
const path = '/api/management/providers/sample'
const input = {
  recognition: { id: recognitionId, version: 1 },
  translation: { id: translationId, version: 1 },
  outputLanguage: 'zh-Hant',
  audioBase64: wave.toString('base64'),
}
async function start() {
  const server = await identity.start({ BABEL_TEST_PROVIDER_ORIGIN: network.origin }, [
    './scripts/fixtures/provider-network.mjs',
  ])
  servers.push(server)
  return server
}
async function request(
  server,
  auth,
  route,
  method = 'POST',
  body = input,
  headers = {},
) {
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
    body: JSON.stringify(body),
  })
}
async function pastCooldown() {
  await pool.query(
    "update provider_configuration set last_test_started_at = now() - interval '1 minute' where id = any($1::uuid[])",
    [[recognitionId, translationId]],
  )
}
async function result(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus)
  const text = await response.text()
  assert.equal(text.includes(recognitionKey) || text.includes(translationKey), false)
  return JSON.parse(text)
}

try {
  const server = await start()
  const auth = await identity.signIn(server)
  const recognition = {
    name: '样本识别',
    expectedVersion: 0,
    settings: { type: 'soniox', model: 'stt-rt-v5', timeoutMs: 5_000 },
    credential: recognitionKey,
  }
  const translation = {
    name: '样本翻译',
    expectedVersion: 0,
    settings: {
      type: 'deepl',
      endpoint: 'https://api-free.deepl.com',
      model: 'prefer_quality_optimized',
      timeoutMs: 5_000,
    },
    credential: translationKey,
  }
  await result(
    await request(
      server,
      auth,
      `/api/management/providers/${recognitionId}`,
      'PUT',
      recognition,
    ),
  )
  await result(
    await request(
      server,
      auth,
      `/api/management/providers/${translationId}`,
      'PUT',
      translation,
    ),
  )
  assert.equal((await fetch(`${server.origin}${path}`, { method: 'POST' })).status, 401)
  assert.equal(
    (await request(server, auth, path, 'POST', input, { cookie: '' })).status,
    401,
  )
  assert.equal(
    (
      await request(server, auth, path, 'POST', input, {
        'cf-access-jwt-assertion': 'forged',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await request(server, auth, path, 'POST', input, {
        origin: 'https://attacker.example',
      })
    ).status,
    403,
  )
  const stereo = Buffer.from(wave)
  stereo.writeUInt16LE(2, 22)
  for (const invalidWave of [
    wave.subarray(0, 100),
    stereo,
    syntheticWave(48_000, 10_020),
  ]) {
    assert.equal(
      (
        await request(server, auth, path, 'POST', {
          ...input,
          audioBase64: invalidWave.toString('base64'),
        })
      ).status,
      400,
    )
  }
  assert.equal(
    (
      await fetch(`${server.origin}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          origin: server.origin,
          cookie: auth.cookie,
          'cf-access-jwt-assertion': auth.jwt,
          'content-type': 'application/json',
        },
        duplex: 'half',
        body: (async function* () {
          const oversized = JSON.stringify({
            ...input,
            audioBase64: 'A'.repeat(1_400_001),
          })
          for (let offset = 0; offset < oversized.length; offset += 32_768) {
            yield oversized.slice(offset, offset + 32_768)
          }
        })(),
      })
    ).status,
    413,
    'Enforce the upload bound without relying on a Content-Length header',
  )
  assert.equal(
    (
      await request(server, auth, path, 'POST', {
        ...input,
        recognition: { id: recognitionId, version: 99 },
      })
    ).status,
    409,
  )
  assert.equal(
    network.observations.length,
    0,
    'Invalid input must not send audio or spend a provider request',
  )
  await pastCooldown()
  const preview = await result(await request(server, auth, path))
  assert.equal(preview.code, 'PASS')
  assert.equal(preview.audioDurationMs, 1000)
  assert.deepEqual(
    preview.segments.map((segment) => segment.text),
    ['Do not attack', 'Wait 3 seconds.'],
  )
  assert.equal(
    preview.segments.every(
      (segment) => segment.isFinal && segment.translationRevision === 1,
    ),
    true,
  )
  assert.ok(
    preview.segments[0].revision >= 3,
    'Corrected source replaces earlier hypotheses',
  )
  assert.notEqual(preview.segments[0].utteranceId, preview.segments[1].utteranceId)
  assert.equal(preview.segments[0].audioStartMs, 0)
  assert.equal(preview.segments[0].audioEndMs, 320)
  assert.equal(preview.segments[1].audioStartMs, null)
  assert.equal(preview.segments[1].audioEndMs, null)
  assert.deepEqual(
    preview.segments.map((segment) => segment.translatedText),
    ['fixture:ZH-HANT', 'fixture:ZH-HANT'],
  )
  const audioRequest = network.observations.find((value) => value.protocol === 'soniox')
  assert.equal(
    audioRequest.audioDigest,
    createHash('sha256').update(wave.subarray(44)).digest('hex'),
  )
  assert.ok(
    audioRequest.elapsedMs >= 900,
    'Pace audio instead of compressing the sample timeline',
  )
  assert.ok(
    audioRequest.frames.some((frame) => frame.silence) &&
      audioRequest.frames.some((frame) => !frame.silence),
  )
  const translations = network.observations.filter(
    (value) => value.protocol === 'deepl',
  )
  assert.deepEqual(
    translations.map((value) => value.body.text),
    [['Do not attack'], ['Wait 3 seconds.']],
  )
  assert.ok(
    translations.every(
      (value) =>
        value.body.source_lang === 'EN' && value.body.target_lang === 'ZH-HANT',
    ),
  )
  const saved = (
    await pool.query(
      'select enabled, last_test from provider_configuration where id = any($1::uuid[])',
      [[recognitionId, translationId]],
    )
  ).rows
  assert.ok(
    saved.every((value) => value.enabled === false && value.last_test === null),
    'Sample comparison neither enables a candidate nor overwrites connection-test evidence',
  )

  await pastCooldown()
  network.setMode(recognitionKey, 'pass')
  const beforeSilence = network.observations.filter(
    (value) => value.protocol === 'deepl',
  ).length
  const silence = await result(await request(server, auth, path))
  assert.equal(silence.code, 'NO_SPEECH')
  assert.equal(silence.segments.length, 0)
  assert.equal(
    network.observations.filter((value) => value.protocol === 'deepl').length,
    beforeSilence,
  )
  await pastCooldown()
  network.setMode(recognitionKey, 'speech')
  network.setMode(translationKey, 'quota')
  const failed = await result(await request(server, auth, path))
  assert.equal(failed.code, 'QUOTA_EXHAUSTED')
  assert.ok(
    failed.segments.every(
      (value) => value.failure === 'QUOTA_EXHAUSTED' && value.translatedText === '',
    ),
  )

  // The sample owns two configuration test slots. Validate the whole snapshot
  // after network work, including a configuration replaced after lease expiry.
  await pastCooldown()
  network.setMode(translationKey, 'pass')
  const hold = network.hold(translationKey)
  const pending = request(server, auth, path)
  await Promise.race([
    hold.started,
    setTimeout(5_000).then(() => {
      throw new Error('Sample did not reach translation fixture')
    }),
  ])
  const second = await start()
  for (const id of [recognitionId, translationId]) {
    assert.equal(
      (
        await request(second, auth, `/api/management/providers/${id}/test`, 'POST', {
          expectedVersion: 1,
        })
      ).status,
      409,
    )
  }
  await pool.query(
    "update provider_configuration set test_lease_until = now() - interval '1 second' where id = $1",
    [translationId],
  )
  const changed = await result(
    await request(second, auth, `/api/management/providers/${translationId}`, 'PUT', {
      expectedVersion: 1,
      name: '较新的样本翻译',
      settings: translation.settings,
    }),
  )
  assert.equal(changed.version, 2)
  hold.release()
  assert.equal(
    (await pending).status,
    409,
    'Never return obsolete configuration evidence as a successful sample',
  )
  const leases = (
    await pool.query(
      'select test_lease_id from provider_configuration where id = any($1::uuid[])',
      [[recognitionId, translationId]],
    )
  ).rows
  assert.ok(leases.every((row) => row.test_lease_id === null))
  const audits = (
    await pool.query(
      "select metadata from audit_event where actor_subject = $1 and action = 'provider.sample'",
      [identity.actor],
    )
  ).rows
  assert.equal(audits.length, 3)
  assert.ok(
    audits.every(
      (row) => Object.keys(row.metadata).sort().join(',') === 'code,configurations',
    ),
  )
  const auditText = JSON.stringify(audits)
  for (const privateValue of [
    recognitionKey,
    translationKey,
    'Do not attack',
    input.audioBase64,
  ]) {
    assert.equal(auditText.includes(privateValue), false)
  }
  const configuration = await (await fetch(`${second.origin}/api/player/config`)).json()
  assert.deepEqual(configuration.outputLanguages, [])
  console.log(
    'PASS authenticated audio sample HTTP + PostgreSQL: bounded WAV input, paced PCM with preserved pauses, corrected/final utterances, honest timestamps, separate text translation, no-speech/quota outcomes, two-config leases, stale-result rejection and redacted audit. Speech responses and translations are local fixtures; live quality remains untested.',
  )
} finally {
  await network.close()
  await Promise.all(servers.map((server) => server.close()))
  await pool.query('delete from provider_configuration where id = any($1::uuid[])', [
    [recognitionId, translationId],
  ])
  await pool.query('delete from audit_event where actor_subject = $1', [identity.actor])
  await pool.query('delete from auth_user where id = $1', [identity.actor])
  await pool.end()
}
