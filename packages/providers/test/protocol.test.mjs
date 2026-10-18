import assert from 'node:assert/strict'
import { test } from 'node:test'
import { testProviderConnection, translateDeepL } from '../src/index.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'

test('provider protocols preserve language scripts, bound failures and complete framed silence', async () => {
  const fixture = await createProviderFixture()
  const restore = routeProviderNetwork(fixture.origin)
  const deepl = {
    type: 'deepl',
    endpoint: 'https://api-free.deepl.com',
    model: 'prefer_quality_optimized',
    timeoutMs: 1_000,
  }
  const soniox = { type: 'soniox', model: 'stt-rt-v5', timeoutMs: 3_000 }
  try {
    for (const [outputLanguage, expected] of [
      ['zh-CN', 'ZH-HANS'],
      ['zh-TW', 'ZH-HANT'],
      ['ja-JP', 'JA'],
      ['ko-KR', 'KO'],
    ]) {
      const translated = await translateDeepL(deepl, fixture.credential(), {
        text: '指令',
        sourceLanguage: 'zh-Hans',
        outputLanguage,
        context: 'context',
      })
      assert.equal(translated, `fixture:${expected}`)
      const request = fixture.observations.at(-1)
      assert.equal(request.method, 'POST')
      assert.deepEqual(request.body, {
        text: ['指令'],
        source_lang: 'ZH',
        target_lang: expected,
        model_type: 'prefer_quality_optimized',
        context: 'context',
      })
    }
    for (const [mode, code] of [
      ['invalid', 'INVALID_CREDENTIAL'],
      ['quota', 'QUOTA_EXHAUSTED'],
      ['rate', 'RATE_LIMITED'],
      ['model', 'INVALID_CONFIGURATION'],
      ['malformed', 'INVALID_RESPONSE'],
      ['large', 'INVALID_RESPONSE'],
      ['timeout', 'TIMEOUT'],
      ['redirect', 'UNAVAILABLE'],
    ]) {
      const key = fixture.credential(mode)
      const result = await testProviderConnection(deepl, key)
      assert.equal(result.code, code, mode)
      assert.equal(JSON.stringify(result).includes(key), false)
    }
    assert.equal(
      fixture.observations.some((item) => item.protocol === 'redirect'),
      false,
      'Never forward authorization across redirects',
    )
    const before = fixture.observations.length
    assert.equal(
      (
        await testProviderConnection(
          { ...deepl, endpoint: fixture.origin },
          fixture.credential(),
        )
      ).code,
      'INVALID_CONFIGURATION',
    )
    assert.equal(
      fixture.observations.length,
      before,
      'Reject non-allowlisted endpoint before making a request',
    )
    assert.equal(
      (await testProviderConnection(soniox, fixture.credential())).code,
      'PASS',
    )
    const request = fixture.observations.at(-1)
    assert.equal(request.auth, 'soniox-api-key')
    assert.deepEqual(request.configuration, {
      model: 'stt-rt-v5',
      audio_format: 's16le',
      sample_rate: 48_000,
      num_channels: 1,
    })
    assert.equal(request.frames.length, 50)
    assert.ok(request.frames.every((frame) => frame.bytes === 1920 && frame.silence))
    assert.equal(request.end, true, 'Empty text must terminate the audio stream')
    for (const [mode, code] of [
      ['invalid', 'INVALID_CREDENTIAL'],
      ['model', 'MODEL_UNAVAILABLE'],
      ['quota', 'QUOTA_EXHAUSTED'],
      ['malformed', 'INVALID_RESPONSE'],
      ['early', 'INVALID_RESPONSE'],
      ['timeout', 'TIMEOUT'],
    ]) {
      assert.equal(
        (
          await testProviderConnection(
            { ...soniox, timeoutMs: 1_500 },
            fixture.credential(mode),
          )
        ).code,
        code,
        mode,
      )
    }
  } finally {
    restore()
    await fixture.close()
  }
})
