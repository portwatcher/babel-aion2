import assert from 'node:assert/strict'
import { test } from 'node:test'
import { testProviderConnection } from '../src/index.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'

test('OpenAI probes authenticate over real WebSockets and verify both configured model sessions', async (t) => {
  const fixture = await createProviderFixture()
  const restore = routeProviderNetwork(fixture.origin)
  t.after(async () => {
    restore()
    await fixture.close()
  })
  const settings = { type: 'openai', timeoutMs: 1000 }
  const key = fixture.credential()
  assert.equal((await testProviderConnection(settings, key)).code, 'PASS')
  const [recognition, translation] = fixture.observations
  assert.equal(recognition.auth, 'Bearer ' + key)
  assert.equal(translation.auth, 'Bearer ' + key)
  assert.equal(recognition.url, '/v1/realtime?intent=transcription')
  assert.equal(
    translation.url,
    '/v1/realtime/translations?model=gpt-realtime-translate',
  )
  assert.deepEqual(recognition.configuration, {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'gpt-live-transcribe', delay: 'minimal' },
        turn_detection: null,
      },
    },
  })
  assert.deepEqual(translation.configuration, { audio: { output: { language: 'ja' } } })
  for (const [mode, code] of [
    ['invalid', 'INVALID_CREDENTIAL'],
    ['model', 'MODEL_UNAVAILABLE'],
    ['quota', 'QUOTA_EXHAUSTED'],
    ['rate', 'RATE_LIMITED'],
    ['permission', 'PERMISSION_DENIED'],
    ['malformed', 'INVALID_RESPONSE'],
    ['early', 'INVALID_RESPONSE'],
    ['timeout', 'TIMEOUT'],
  ]) {
    assert.equal(
      (await testProviderConnection(settings, fixture.credential(mode))).code,
      code,
      mode,
    )
  }
  const count = fixture.observations.length
  await assert.rejects(
    () => testProviderConnection({ ...settings, endpoint: fixture.origin }, key),
    { code: 'INVALID_CONFIGURATION' },
  )
  assert.equal(
    fixture.observations.length,
    count,
    'untrusted destinations are rejected before networking',
  )
})
