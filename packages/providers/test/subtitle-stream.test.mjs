import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import {
  openSharedSubtitleStream,
  previewSubtitleSample,
  readPcmWave,
} from '../src/index.ts'
import { sendPcmAudio } from '../src/pcm.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'
import { syntheticWave } from '../../../scripts/fixtures/audio-sample.mjs'

const settings = { type: 'openai', timeoutMs: 3000 }
const values = (events) =>
  events.filter((event) => event.type === 'subtitle').map((event) => event.value)
async function until(predicate, message, timeout = 4000) {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) {
    await setTimeout(5)
  }
  assert.ok(predicate(), message)
}
async function fixture(t) {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  t.after(async () => {
    restore()
    await network.close()
  })
  return network
}
function stream(network, key, terminology = null) {
  return openSharedSubtitleStream({
    recognition: { settings, credential: key },
    sampleRate: 48000,
    terminology,
  })
}
function path(key, outputLanguage, version = 1) {
  return { settings, credential: key, outputLanguage, version }
}
test('direct audio fans out by language and translated fragments appear before source finalization or audio end', async (t) => {
  const network = await fixture(t)
  const key = network.credential('speech')
  const s = stream(network, key)
  t.after(() => s.close())
  const a = [],
    b = [],
    korean = []
  s.subscribe(path(key, 'ja'), (event) => a.push(event))
  s.subscribe(path(key, 'ja'), (event) => b.push(event))
  s.subscribe(path(key, 'ko'), (event) => korean.push(event))
  await s.prepare()
  const sent = sendPcmAudio(s, readPcmWave(syntheticWave()), AbortSignal.timeout(8000))
  await until(
    () => values(a).some((value) => value.translatedText.includes('Wait 3 seconds.')),
    'incremental translation before audio finishes',
  )
  const connections = network.observations
  assert.equal(
    connections.filter((value) => value.protocol === 'recognition').length,
    1,
  )
  assert.equal(
    connections.filter((value) => value.protocol === 'translation').length,
    2,
  )
  assert.ok(connections.every((value) => value.frames.length < 50))
  assert.ok(values(a).some((value) => value.translatedText && !value.isFinal))
  assert.ok(
    values(a).some((value) => value.translatedText && !value.translationIsFinal),
  )
  await sent
  assert.deepEqual(a, b)
  assert.ok(
    values(korean).some(
      (value) => value.translatedText === 'fixture:ko:Wait 3 seconds.',
    ),
  )
  assert.ok(
    values(a).at(-1).translationIsFinal,
    'session.closed flushes the last caption',
  )
  assert.ok(
    values(a).every(
      (value) =>
        value.sourceAlignment === 'independent' &&
        value.audioStartMs === null &&
        value.audioEndMs === null,
    ),
  )
  for (const connection of connections) {
    assert.equal(connection.frames.length, 50)
    assert.ok(
      connection.frames.every((frame) => frame.bytes === 960),
      'all endpoints receive 24 kHz 20 ms PCM',
    )
    assert.ok(
      connection.frames.some((frame) => frame.silence),
      'actual silence survives resampling',
    )
  }
})
test('slow or failed translations never delay recognition or another output language', async (t) => {
  const network = await fixture(t)
  const sourceKey = network.credential('speech'),
    japaneseKey = network.credential('speech'),
    koreanKey = network.credential('speech')
  const hold = network.hold(japaneseKey)
  const s = stream(network, sourceKey)
  t.after(() => s.close())
  const japanese = [],
    korean = []
  s.subscribe(path(japaneseKey, 'ja'), (event) => japanese.push(event))
  s.subscribe(path(koreanKey, 'ko'), (event) => korean.push(event))
  await s.prepare()
  const sent = sendPcmAudio(s, readPcmWave(syntheticWave()), AbortSignal.timeout(8000))
  await hold.started
  await until(
    () => values(korean).some((value) => value.translatedText),
    'other language streams while Japanese is held',
  )
  await until(
    () =>
      network.observations
        .filter((value) => value.protocol === 'recognition')
        .some((value) => value.frames.length === 50),
    'audio finishes while Japanese is still held',
  )
  assert.ok(values(japanese).every((value) => !value.translatedText))
  hold.release()
  await sent
})
test('target changes fence obsolete sockets and equal timestamps do not discard distinct deltas', async (t) => {
  const network = await fixture(t)
  const key = network.credential()
  const s = stream(network, key)
  t.after(() => s.close())
  const events = []
  s.subscribe(path(key, 'ja'), (event) => events.push(event))
  await s.prepare()
  const output = network.observations.find((value) => value.protocol === 'translation')
  const delta = (event_id, text) => ({
    type: 'session.output_transcript.delta',
    event_id,
    delta: text,
    elapsed_ms: 200,
  })
  network.emit(key, delta('one', 'Do '), output)
  network.emit(key, delta('two', 'not attack.'), output)
  network.emit(key, delta('two', 'not attack.'), output)
  await until(
    () => values(events).at(-1)?.translatedText === 'Do not attack.',
    'append exact fragments and deduplicate event IDs only',
  )
  s.replaceOutput(path(key, 'ja', 2))
  await until(
    () =>
      network.observations.filter((value) => value.protocol === 'translation')
        .length === 2,
    'replacement connected',
  )
  const replacement = network.observations
    .filter((value) => value.protocol === 'translation')
    .at(-1)
  await until(() => replacement.configuration, 'new target configured')
  network.emit(key, delta('new', 'Retreat.'), replacement)
  await until(
    () => values(events).at(-1)?.translatedText === 'Retreat.',
    'only new configuration is delivered',
  )
  assert.equal(values(events).at(-1).configurationVersion, 2)
  await assert.rejects(async () => s.subscribe(path(key, 'unsupported'), () => {}), {
    code: 'INVALID_CONFIGURATION',
  })
})
test('sample processing uses the same direct streaming path and hints apply only to recognition', async (t) => {
  const network = await fixture(t)
  const key = network.credential('speech')
  const term = {
    sourceTerm: 'TestSkill',
    sourceLanguage: 'en',
    alternatives: ['TS'],
    category: 'skill',
    context: 'Synthetic test term',
    expressions: [{ language: 'ja', text: 'テスト' }],
  }
  const result = await previewSubtitleSample({
    recognition: { settings, credential: key, version: 1 },
    translation: { settings, credential: key, version: 1 },
    outputLanguage: 'ja',
    audio: readPcmWave(syntheticWave()),
    terminology: { version: 1, terms: [term] },
  })
  assert.equal(result.code, 'PASS')
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  const translation = network.observations.find(
    (value) => value.protocol === 'translation',
  )
  assert.deepEqual(recognition.configuration.audio.input.transcription.keywords, [
    'TestSkill',
    'TS',
  ])
  assert.deepEqual(
    translation.configuration,
    { audio: { output: { language: 'ja' } } },
    'no unsupported translation prompt or glossary is sent',
  )
  assert.equal(result.segments.at(-1).translationTermCount, 0)
  assert.ok(result.segments.at(-1).translationIsFinal)
})
