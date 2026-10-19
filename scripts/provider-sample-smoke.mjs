import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
const termId = randomUUID()
const disabledTermId = randomUUID()
const largeTermId = randomUUID()
const recognitionKey = network.credential('speech')
const translationKey = network.credential('speech')
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
  const termInput = {
    expectedVersion: 0,
    sourceTerm: 'attack',
    sourceLanguage: 'en',
    alternatives: ['engage'],
    category: 'Fixture-only action',
    context: 'Local fixture, not confirmed game vocabulary.',
    enabled: true,
    expressions: [
      { language: 'zh-Hant', text: '測試攻擊' },
      { language: 'zh-Hans', text: '测试攻击' },
      { language: 'ja', text: '試験攻撃' },
    ],
  }
  const term = await result(
    await request(server, auth, `/api/management/terms/${termId}`, 'PUT', termInput),
  )
  const disabledTerm = await result(
    await request(server, auth, `/api/management/terms/${disabledTermId}`, 'PUT', {
      ...termInput,
      sourceTerm: 'disabled fixture term',
      alternatives: [],
      enabled: false,
    }),
  )
  const recognition = {
    name: '样本识别',
    expectedVersion: 0,
    settings: { type: 'openai', timeoutMs: 5_000 },
    credential: recognitionKey,
  }
  const translation = {
    name: '样本翻译',
    expectedVersion: 0,
    settings: {
      type: 'openai',
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
  assert.equal(
    (await request(server, auth, path, 'POST', { ...input, outputLanguage: 'und' }))
      .status,
    400,
    'An unknown output language must be rejected before provider work',
  )
  assert.equal(network.observations.length, 0)
  await pastCooldown()
  const preview = await result(
    await request(server, auth, path, 'POST', {
      ...input,
      translation: input.recognition,
    }),
  )
  assert.equal(preview.code, 'PASS')
  assert.equal(preview.audioDurationMs, 1000)
  assert.deepEqual(preview.terminology, {
    version: disabledTerm.version,
    recognitionTermCount: 1,
  })
  assert.equal(preview.segments.at(-1).text, 'Wait 3 seconds.')
  assert.ok(preview.segments.at(-1).isFinal)
  assert.ok(preview.segments.at(-1).translationIsFinal)
  assert.equal(preview.segments.at(-1).translatedText, 'fixture:zh:Wait 3 seconds.')
  assert.ok(
    preview.segments.every(
      (segment) =>
        segment.sourceAlignment === 'independent' &&
        segment.audioStartMs === null &&
        segment.audioEndMs === null,
    ),
  )
  const audioRequest = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  assert.deepEqual(audioRequest.configuration.audio.input.transcription.keywords, [
    'attack',
    'engage',
  ])
  assert.equal(audioRequest.frames.length, 50)
  assert.ok(audioRequest.frames.every((frame) => frame.bytes === 960))
  assert.ok(
    audioRequest.frames.some((frame) => frame.silence) &&
      audioRequest.frames.some((frame) => !frame.silence),
  )
  const translations = network.observations.filter(
    (value) => value.protocol === 'translation',
  )
  assert.equal(translations.length, 1, 'One continuous audio connection per target')
  assert.deepEqual(translations[0].configuration, {
    audio: { output: { language: 'zh' } },
  })
  assert.ok(preview.segments.every((segment) => segment.translationTermCount === 0))
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
  const beforeOptOut = network.observations.length
  const optOut = await result(
    await request(server, auth, path, 'POST', { ...input, includeTerms: false }),
  )
  assert.equal(optOut.code, 'PASS')
  assert.equal(optOut.terminology, null)
  assert.ok(optOut.segments.every((segment) => segment.translationTermCount === 0))
  assert.ok(
    network.observations
      .slice(beforeOptOut)
      .every(
        (observation) =>
          observation.protocol !== 'recognition' ||
          observation.configuration.audio.input.transcription.keywords === undefined,
      ),
  )

  await pastCooldown()
  network.setMode(recognitionKey, 'pass')
  network.setMode(translationKey, 'pass')
  const beforeSilence = network.observations.filter(
    (value) => value.protocol === 'translation',
  ).length
  const silence = await result(await request(server, auth, path))
  assert.equal(silence.code, 'NO_SPEECH')
  assert.ok(
    silence.segments.every((segment) => !segment.text && !segment.translatedText),
  )
  assert.equal(
    network.observations.filter((value) => value.protocol === 'translation').length,
    beforeSilence + 1,
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

  await pastCooldown()
  network.setMode(translationKey, 'speech')
  const termHold = network.hold(translationKey)
  const pendingTerms = request(server, auth, path)
  await Promise.race([
    termHold.started,
    setTimeout(5_000).then(() => {
      throw new Error('Term snapshot sample did not reach translation')
    }),
  ])
  await result(
    await request(server, auth, `/api/management/terms/${termId}`, 'PUT', {
      ...termInput,
      expectedVersion: term.version,
      context: 'Newer terminology snapshot',
    }),
  )
  termHold.release()
  const staleTerms = await result(await pendingTerms, 409)
  assert.equal(staleTerms.data.code, 'TERMINOLOGY_CHANGED')

  const largeInput = {
    ...termInput,
    sourceTerm: '界'.repeat(118) + 'zz',
    alternatives: Array.from(
      { length: 12 },
      (_, index) => '界'.repeat(118) + String(index).padStart(2, '0'),
    ),
    context: '测'.repeat(400),
  }
  const largeTerm = await result(
    await request(
      server,
      auth,
      `/api/management/terms/${largeTermId}`,
      'PUT',
      largeInput,
    ),
  )
  await pastCooldown()
  const beforeLargeContext = network.observations.length
  const largeContext = await result(await request(server, auth, path))
  assert.equal(largeContext.code, 'CONTEXT_TOO_LARGE')
  assert.equal(
    network.observations.length,
    beforeLargeContext,
    'Reject oversized terminology before sending audio or text',
  )
  await result(
    await request(server, auth, `/api/management/terms/${largeTermId}`, 'PUT', {
      ...largeInput,
      expectedVersion: largeTerm.version,
      enabled: false,
    }),
  )

  // The sample owns two configuration test slots. Validate the whole snapshot
  // after network work, including a configuration replaced after lease expiry.
  await pastCooldown()
  network.setMode(translationKey, 'speech')
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
  assert.equal(audits.length, 5)
  assert.ok(
    audits.every(
      (row) =>
        Object.keys(row.metadata).sort().join(',') ===
        'code,configurations,terminologyVersion',
    ),
  )
  const auditText = JSON.stringify(audits)
  for (const privateValue of [
    recognitionKey,
    translationKey,
    'Do not attack',
    '測試攻擊',
    'Newer terminology snapshot',
    input.audioBase64,
  ]) {
    assert.equal(auditText.includes(privateValue), false)
  }
  const configuration = await (await fetch(`${second.origin}/api/player/config`)).json()
  assert.deepEqual(configuration.outputLanguages, [])
  console.log(
    'PASS authenticated audio sample HTTP + PostgreSQL: bounded WAV input, paced PCM and revisions, separate translation, versioned terminology context and opt-out, context limits, no-speech/quota outcomes, provider/term stale-result rejection and redacted audit. Speech responses, terms and translations are local fixtures; live quality remains untested.',
  )
} finally {
  await network.close()
  await Promise.all(servers.map((server) => server.close()))
  await pool.query('delete from provider_configuration where id = any($1::uuid[])', [
    [recognitionId, translationId],
  ])
  await pool.query('delete from game_term where id = any($1::uuid[])', [
    [termId, disabledTermId, largeTermId],
  ])
  await pool.query("update term_catalog set version = version + 1 where id = 'global'")
  await pool.query('delete from audit_event where actor_subject = $1', [identity.actor])
  await pool.query('delete from auth_user where id = $1', [identity.actor])
  await pool.end()
}
