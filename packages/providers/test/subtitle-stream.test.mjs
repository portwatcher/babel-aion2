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

function speechFrame() {
  const buf = Buffer.alloc(1920)
  for (let i = 0; i < buf.length; i += 2) {
    buf.writeInt16LE(4000, i)
  }
  return buf
}

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

test('one shared recognition stream drives streaming text translations before audio finishes without duplicate final calls', async (t) => {
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
    () =>
      values(a).some((value) => value.translatedText.includes('Wait 3 seconds.')) &&
      values(korean).some((value) => value.translatedText.includes('Wait 3 seconds.')),
    'incremental translation before audio finishes',
  )
  const recognitions = network.observations.filter(
    (value) => value.protocol === 'recognition',
  )
  const translationCalls = () =>
    network.observations.filter((value) => value.protocol === 'translation')
  const callsBeforeCommit = translationCalls().length
  assert.ok(callsBeforeCommit >= 2)
  assert.equal(recognitions.length, 1, 'exactly one recognition socket')
  assert.ok(recognitions[0].frames.length < 50)
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
    'completed utterance marks aligned translation final without waiting for socket close',
  )
  assert.ok(
    values(a).every(
      (value) =>
        value.sourceAlignment === 'aligned' &&
        value.audioStartMs === null &&
        value.audioEndMs === null,
    ),
  )
  const translations = translationCalls()
  assert.equal(
    translations.length,
    callsBeforeCommit,
    'identical completed transcript reuses streamed translation without a second HTTP call',
  )
  assert.ok(
    translations.every(
      (item) =>
        item.model === 'gpt-5.4-nano' &&
        item.stream &&
        item.configuration.reasoning_effort === 'none',
    ),
  )
  assert.ok(
    recognitions[0].frames.every((frame) => frame.bytes === 960),
    'recognition receives 24 kHz 20 ms PCM',
  )
  assert.ok(
    recognitions[0].frames.some((frame) => frame.silence),
    'pre-roll and hangover silence frames preserve utterance boundaries',
  )
})

test('VAD silence gating drops prolonged silence, preserves 160 ms pre-roll, rides over short pauses, and commits after 500 ms hangover', async (t) => {
  const network = await fixture(t)
  const key = network.credential('pass')
  const s = stream(network, key)
  t.after(() => s.close())
  s.subscribe(path(key, 'ja'), () => {})
  await s.prepare()
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  let offset = 0
  const silent = Buffer.alloc(1920)
  const voiced = speechFrame()

  // 25 frames (500 ms) of silence: nothing sent over the WebSocket.
  for (let i = 0; i < 25; i++) {
    s.write(silent, offset)
    offset += 960
  }
  await setTimeout(20)
  assert.equal(recognition.frames.length, 0, 'silence sends zero frames')
  assert.equal(s.sentAudioMs(), 0)

  // 10 frames (200 ms) of speech: flushes 8 pre-roll silent frames + 10 speech frames.
  for (let i = 0; i < 10; i++) {
    s.write(voiced, offset)
    offset += 960
  }
  await until(() => recognition.frames.length === 18, '8 pre-roll + 10 voiced frames')
  assert.equal(
    recognition.frames.slice(0, 8).every((f) => f.silence),
    true,
  )
  assert.equal(
    recognition.frames.slice(8, 18).every((f) => !f.silence),
    true,
  )

  // 12 frames (240 ms) mid-sentence pause + 10 frames speech: must NOT split utterance.
  for (let i = 0; i < 12; i++) {
    s.write(silent, offset)
    offset += 960
  }
  for (let i = 0; i < 10; i++) {
    s.write(voiced, offset)
    offset += 960
  }
  await until(
    () => recognition.frames.length === 40,
    'pause and resumed speech stay open',
  )
  assert.equal(recognition.end, false, '240 ms breath/geminate pause does not commit')

  // 40 frames (800 ms) of silence: sends 25 hangover frames (500 ms), commits, then gates.
  for (let i = 0; i < 40; i++) {
    s.write(silent, offset)
    offset += 960
  }
  await until(() => recognition.end === true, '500 ms silence commits utterance')
  await setTimeout(20)
  assert.equal(
    recognition.frames.length,
    65,
    '8 pre-roll + 10 voiced + 12 pause + 10 voiced + 25 hangover; remaining 15 gated',
  )
  assert.equal(s.sentAudioMs(), 1300)
})

test('TLS wss:// pre-roll bursts across multiple utterances never trip socket bufferedAmount limit', async (t) => {
  const network = await createProviderFixture({ tls: true })
  const restore = routeProviderNetwork(network.origin, { ca: network.ca })
  t.after(async () => {
    restore()
    await network.close()
  })
  const key = network.credential('sentences')
  const s = stream(network, key)
  t.after(() => s.close())
  const events = []
  s.subscribe(path(key, 'en'), (event) => events.push(event))
  await s.prepare()
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  let offset = 0
  const silent = Buffer.alloc(1920)
  const voiced = speechFrame()

  // Utterance 1 after prolonged silence (fills all 8 pre-roll frames before onset).
  for (let i = 0; i < 20; i++) {
    s.write(silent, offset)
    offset += 960
  }
  for (let i = 0; i < 10; i++) {
    s.write(voiced, offset)
    offset += 960
  }
  // 700 ms silence: commits utterance 1, closes VAD gate, and refills all 8 pre-roll frames.
  for (let i = 0; i < 35; i++) {
    s.write(silent, offset)
    offset += 960
  }
  // Utterance 2 after second pre-roll burst.
  for (let i = 0; i < 10; i++) {
    s.write(voiced, offset)
    offset += 960
  }
  for (let i = 0; i < 30; i++) {
    s.write(silent, offset)
    offset += 960
  }
  await until(
    () =>
      values(events).some((value) => value.text === 'Do not attack.' && value.isFinal),
    'both utterances complete cleanly over real TLS without bufferedAmount crash',
  )
  assert.equal(
    events.some((event) => event.type === 'failure'),
    false,
    'TLS pre-roll bursts emit zero provider failures',
  )
  assert.equal(recognition.closed, false)
})

test('unused targets cancel in-flight translation immediately and reopen cleanly for new subscribers', async (t) => {
  const network = await fixture(t)
  const key = network.credential()
  const japaneseKey = network.credential()
  const held = network.hold(japaneseKey, 'translation')
  const s = stream(network, key)
  t.after(() => {
    held.release()
    s.close()
  })
  const japanese = [],
    korean = []
  const removeA = s.subscribe(path(japaneseKey, 'ja'), (event) => japanese.push(event))
  const removeB = s.subscribe(path(japaneseKey, 'ja'), (event) => japanese.push(event))
  const removeKorean = s.subscribe(path(key, 'ko'), (event) => korean.push(event))
  await s.prepare()
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  network.emit(
    key,
    {
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'utt_1',
      delta: 'Hold the gate.',
    },
    recognition,
  )
  await held.started
  await until(
    () => values(korean).at(-1)?.translatedText === 'fixture:ko:Hold the gate.',
    'Korean translates independently while Japanese is held',
  )
  const old = network.observations.find((value) => value.key === japaneseKey)
  removeA()
  assert.equal(old.closed, false, 'remaining listener retains in-flight translation')
  removeB()
  await until(() => old.closed, 'last listener aborts in-flight HTTP request', 1000)
  held.release()
  assert.equal(
    values(japanese).every((value) => value.translatedText === ''),
    true,
    'cancelled target never publishes translated text',
  )
  const resumed = []
  const removeResumed = s.subscribe(path(japaneseKey, 'ja'), (event) =>
    resumed.push(event),
  )
  network.emit(
    key,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'utt_2',
      transcript: 'Move forward.',
    },
    recognition,
  )
  await until(
    () =>
      values(resumed).at(-1)?.translatedText === 'fixture:ja:Move forward.' &&
      values(korean).at(-1)?.translatedText === 'fixture:ko:Move forward.',
    'resumed target and retained target translate new utterances',
  )
  assert.equal(
    values(resumed).some((value) => value.text.includes('Hold the gate.')),
    false,
    'resumed subscriber receives no pre-subscription speech',
  )
  removeResumed()
  removeKorean()
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
        .some((value) => value.frames.length >= 40),
    'audio finishes while Japanese is still held',
  )
  assert.ok(values(japanese).every((value) => !value.translatedText))
  hold.release()
  await sent
  assert.ok(
    values(japanese).some(
      (value) => value.translatedText === 'fixture:ja:Wait 3 seconds.',
    ),
  )
})

test('target replacement fences obsolete requests, connecting source keeps newest 100 ms, and transient errors recover', async (t) => {
  const network = await fixture(t)
  const sourceKey = network.credential(),
    japaneseKey = network.credential(),
    koreanKey = network.credential()
  const heldSource = network.hold(sourceKey, 'recognition', true)
  const s = stream(network, sourceKey)
  t.after(() => {
    heldSource.release()
    s.close()
  })
  const japanese = [],
    korean = []
  s.subscribe(path(japaneseKey, 'ja'), (event) => japanese.push(event))
  s.subscribe(path(koreanKey, 'ko'), (event) => korean.push(event))
  await heldSource.started
  let offset = 0
  const voiced = speechFrame()
  for (let i = 0; i < 10; i++) {
    s.write(voiced, offset)
    offset += 960
  }
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  assert.equal(recognition.frames.length, 0)
  heldSource.release()
  await s.ready
  await until(
    () => recognition.frames.length === 5,
    'source retains only the newest 100 ms while connecting',
  )

  network.emit(
    sourceKey,
    { type: 'input_audio_buffer.committed', item_id: 'older' },
    recognition,
  )
  network.emit(
    sourceKey,
    { type: 'input_audio_buffer.committed', item_id: 'newer' },
    recognition,
  )
  network.emit(
    sourceKey,
    {
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'newer',
      delta: 'Retreat.',
    },
    recognition,
  )
  await until(
    () => values(korean).at(-1)?.translatedText === 'fixture:ko:Retreat.',
    'current source fragment translated',
  )
  network.emit(
    sourceKey,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'older',
      transcript: 'Attack.',
    },
    recognition,
  )
  await setTimeout(60)
  assert.equal(values(korean).at(-1).text, 'Retreat.')

  network.emit(
    sourceKey,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'newer',
      transcript: '',
    },
    recognition,
  )
  await until(
    () =>
      values(korean).at(-1)?.text === '' &&
      values(korean).at(-1)?.translatedText === '',
    'a retracted hypothesis clears both original and translated text',
  )

  // Hold Korean HTTP response and disconnect mid-flight to trigger transient recovery.
  const holdKorean = network.hold(koreanKey, 'translation')
  network.emit(
    sourceKey,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'recover_item',
      transcript: 'Hold line.',
    },
    recognition,
  )
  await holdKorean.started
  network.disconnect(koreanKey)
  holdKorean.release()
  await until(
    () => values(korean).at(-1)?.translatedText === 'fixture:ko:Hold line.',
    'disconnected HTTP translation retries and recovers automatically',
  )
  assert.equal(values(korean).at(-1).discontinuity, true)

  s.replaceOutput(path(japaneseKey, 'ja', 2))
  network.emit(
    sourceKey,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'after_replace',
      transcript: 'Advance.',
    },
    recognition,
  )
  await until(
    () => values(japanese).at(-1)?.translatedText === 'fixture:ja:Advance.',
    'replaced configuration translates with updated version',
  )
  assert.equal(values(japanese).at(-1).configurationVersion, 2)
  await assert.rejects(
    async () => s.subscribe(path(sourceKey, 'unsupported'), () => {}),
    {
      code: 'INVALID_CONFIGURATION',
    },
  )
})

for (const long of [false, true]) {
  test(`sample streaming bounds ${long ? 'long' : 'short'} recognition hints and injects target glossary into translation`, async (t) => {
    const network = await fixture(t)
    const key = network.credential('speech')
    const term = {
      sourceTerm: 'TestSkill',
      sourceLanguage: 'en',
      alternatives: ['TS'],
      category: 'skill',
      context: long ? '🛡'.repeat(150) : 'Synthetic test term',
      expressions: [{ language: 'ja', text: 'テスト' }],
    }
    const terms = long
      ? [
          term,
          ...['Second', 'Third', 'Last'].map((name) => ({
            ...term,
            sourceTerm: `${name}Skill`,
            alternatives: [name],
          })),
        ]
      : [term]
    const audio = readPcmWave(syntheticWave())
    audio.data = audio.data.subarray(0, audio.data.length - 2)
    audio.durationMs = audio.data.length / 96
    const result = await previewSubtitleSample({
      recognition: { settings, credential: key, version: 1 },
      translation: { settings, credential: key, version: 1 },
      outputLanguage: 'ja',
      audio,
      terminology: { version: 1, terms },
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
      ...(long
        ? ['SecondSkill', 'Second', 'ThirdSkill', 'Third', 'LastSkill', 'Last']
        : []),
    ])
    const prompt = recognition.configuration.audio.input.transcription.prompt
    assert.ok(prompt.length <= 1024, 'provider prompt character limit')
    assert.equal(prompt.isWellFormed(), true, 'Unicode hints remain intact')
    assert.equal(
      recognition.configuration.audio.input.transcription.languages,
      undefined,
      'omit languages so gpt-live-transcribe auto-detects spoken language freely',
    )
    assert.equal(translation.model, 'gpt-5.4-nano')
    const systemPrompt = translation.messages.find((m) => m.role === 'system').content
    assert.ok(systemPrompt.includes('TestSkill (TS) => テスト'))
    assert.equal(result.segments.at(-1).translationTermCount, terms.length)
    assert.ok(result.segments.at(-1).translationIsFinal)
  })
}

test('multilingual terminology catalog keeps recognition prompt neutral without mixed-script keywords while supplying cross-language translation glossary', async (t) => {
  const network = await fixture(t)
  const key = network.credential('speech')
  const terms = [
    {
      sourceTerm: '키스크',
      sourceLanguage: 'ko',
      alternatives: [],
      category: 'Resurrection point',
      context: 'Portable resurrection point.',
      expressions: [
        { language: 'zh-Hans', text: '奇斯克' },
        { language: 'ja', text: 'キスク' },
        { language: 'ko', text: '키스크' },
      ],
    },
    {
      sourceTerm: 'Kisk',
      sourceLanguage: 'en',
      alternatives: [],
      category: 'Resurrection point',
      context: 'Portable resurrection point.',
      expressions: [
        { language: 'zh-Hans', text: '奇斯克' },
        { language: 'ja', text: 'キスク' },
        { language: 'ko', text: '키스크' },
      ],
    },
  ]
  const s = stream(network, key, { version: 2, terms })
  t.after(() => s.close())
  const events = []
  s.subscribe(path(key, 'en'), (event) => events.push(event))
  await s.prepare()
  const recognition = network.observations.find(
    (value) => value.protocol === 'recognition',
  )
  assert.equal(
    recognition.configuration.audio.input.transcription.keywords,
    undefined,
    'multilingual catalog omits mixed-script keywords from STT to avoid cross-script hijacking',
  )
  assert.equal(
    recognition.configuration.audio.input.transcription.prompt,
    'AION2 Steam Global / Asia voice chat battle commands.',
  )
  network.emit(
    key,
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'jp_1',
      transcript: 'キスクを壊して左に集まって',
    },
    recognition,
  )
  await until(
    () => values(events).at(-1)?.translationIsFinal,
    'Japanese transcript translates to English with cross-language glossary',
  )
  const translation = network.observations.find(
    (value) => value.protocol === 'translation',
  )
  assert.equal(translation.model, 'gpt-5.4-nano')
  const systemPrompt = translation.messages.find((m) => m.role === 'system').content
  assert.ok(systemPrompt.includes('- Kisk (奇斯克, キスク, 키스크) => Kisk'))
  assert.equal(values(events).at(-1).translationTermCount, 1)
})
