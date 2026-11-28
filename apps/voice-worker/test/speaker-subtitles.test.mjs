import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import {
  CLOCK_STALL_MS,
  IDLE_SPEAKER_MS,
  SpeakerSubtitles,
} from '../src/speaker-subtitles.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'

async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!predicate() && Date.now() < deadline) {
    await delay(5)
  }
  assert.ok(predicate(), 'provider received the expected audio')
}

function makePath(credential) {
  const settings = { type: 'openai', timeoutMs: 3000 }
  const provider = { settings, credential }
  return {
    key: 'ja:1',
    group: 'recognition:1',
    version: 1,
    recognition: provider,
    translation: provider,
    terminology: null,
    stamp: {
      code: 'ja',
      pathVersion: 1,
      recognitionId: 'recognition',
      recognitionVersion: 1,
      translationId: 'translation',
      translationVersion: 1,
      terminologyVersion: null,
    },
  }
}

for (const callbackMs of [20, 21]) {
  test(`subtitle audio keeps real-time pace with ${callbackMs} ms callbacks and gates prolonged silence`, async (t) => {
    const network = await createProviderFixture()
    const restore = routeProviderNetwork(network.origin)
    t.after(async () => {
      restore()
      await network.close()
    })
    let now = 0
    t.mock.method(performance, 'now', () => now)
    t.mock.timers.enable({ apis: ['setInterval'] })
    const path = makePath(network.credential())
    const ended = []
    const speaker = new SpeakerSubtitles(
      '00000000-0000-4000-8000-000000000001',
      1,
      1,
      'host',
      () => 'Host',
      path.group,
      path,
      () => true,
      (code, reason) => ended.push({ code, reason }),
    )
    t.after(() => speaker.close())
    speaker.reconcile(
      [{ id: 'listener', outputLanguage: 'ja', deliver() {} }],
      new Map([['ja', path]]),
    )
    await until(
      () =>
        network.observations.length === 1 &&
        Boolean(network.observations[0].configuration),
    )
    await delay(10)
    const speech = Buffer.alloc(3840)
    for (let offset = 0; offset < speech.length; offset += 2) {
      speech.writeInt16LE(4000, offset)
    }
    // 3,000 ms of speech followed by 1,000 ms of silence: all speech frames plus
    // 500 ms (25 frames) of hangover reach OpenAI, then VAD stops sending silence.
    for (now = 1; now <= 4000; now += 1) {
      if (now <= 3000 && now % 20 === 0) {
        speaker.receive(speech)
      }
      if (now % callbackMs === 0) {
        t.mock.timers.tick(20)
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    assert.deepEqual(ended, [], 'normal timer drift must not restart recognition')
    const recognition = network.observations[0]
    await until(() => recognition.frames.length >= 174)
    assert.ok(
      recognition.frames.length <= 176,
      'silence after 500 ms hangover is gated',
    )
    assert.ok(
      recognition.frames.filter((frame) => !frame.silence).length >= 149,
      'continuous speech reaches recognition without dropping frames',
    )
    assert.equal(
      recognition.frames.slice(-24).every((frame) => frame.silence),
      true,
      '500 ms trailing hangover preserves utterance boundary after filter tail',
    )
    assert.equal(recognition.closed, false)
    // A brief 200 ms CPU/GC stall drains cleanly without tearing down recognition.
    now += 200
    t.mock.timers.tick(20)
    assert.deepEqual(ended, [], 'brief 200 ms stall stays within clock tolerance')
    // A genuine stall beyond CLOCK_STALL_MS still retires the stream cleanly.
    now += CLOCK_STALL_MS + 100
    t.mock.timers.tick(20)
    assert.deepEqual(ended, [{ code: 'UNAVAILABLE', reason: 'clock-stall' }])
  })
}

test('opening speech during handshake is flushed once ready and 200 ms UDP bursts do not trigger audio-backlog', async (t) => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  t.after(async () => {
    restore()
    await network.close()
  })
  const key = network.credential()
  const held = network.hold(key, 'recognition', true)
  t.after(() => held.release())
  let now = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setInterval'] })
  const path = makePath(key)
  const ended = []
  const states = []
  const speaker = new SpeakerSubtitles(
    '00000000-0000-4000-8000-000000000001',
    1,
    1,
    'host',
    () => 'Host',
    path.group,
    path,
    () => true,
    (code, reason) => ended.push({ code, reason }),
  )
  t.after(() => speaker.close())
  speaker.reconcile(
    [
      {
        id: 'listener',
        outputLanguage: 'ja',
        deliver(event) {
          if (event.type === 'subtitle-state') {
            states.push(event.state)
          }
        },
      },
    ],
    new Map([['ja', path]]),
  )
  assert.deepEqual(states, ['CONNECTING'], 'listener sees CONNECTING during handshake')
  await held.started
  const speech = Buffer.alloc(3840)
  for (let offset = 0; offset < speech.length; offset += 2) {
    speech.writeInt16LE(4000, offset)
  }
  // 25 frames (500 ms) of opening speech arrive while the WebSocket is still connecting.
  for (let i = 1; i <= 25; i += 1) {
    now = i * 20
    speaker.receive(speech)
  }
  const recognition = network.observations[0]
  assert.equal(recognition.frames.length, 0, 'nothing sent before session.updated')
  held.release()
  await until(() => recognition.frames.length === 25)
  assert.deepEqual(
    states,
    ['CONNECTING', 'WAITING'],
    'handshake completion leaves CONNECTING even before the first transcript arrives',
  )
  assert.deepEqual(ended, [], 'preconnect flush succeeds without errors')

  // 10 frames (200 ms) arriving in a single UDP jitter burst must NOT retire the stream.
  now += 20
  for (let i = 0; i < 10; i += 1) {
    speaker.receive(speech)
  }
  assert.deepEqual(ended, [], '200 ms receive burst stays within live queue headroom')

  // Genuine multi-hundred-ms overflow (>400 ms) still fails closed as audio-backlog.
  for (let i = 0; i < 20; i += 1) {
    speaker.receive(speech)
  }
  assert.deepEqual(ended, [{ code: 'UNAVAILABLE', reason: 'audio-backlog' }])
})

test('idle speaker releases recognition WebSocket cleanly after 90 s without speech', async (t) => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  t.after(async () => {
    restore()
    await network.close()
  })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setInterval'] })
  const path = makePath(network.credential())
  const ended = []
  const speaker = new SpeakerSubtitles(
    '00000000-0000-4000-8000-000000000001',
    1,
    1,
    'host',
    () => 'Host',
    path.group,
    path,
    () => true,
    (code, reason) => ended.push({ code, reason }),
  )
  t.after(() => speaker.close())
  speaker.reconcile(
    [{ id: 'listener', outputLanguage: 'ja', deliver() {} }],
    new Map([['ja', path]]),
  )
  await until(
    () =>
      network.observations.length === 1 &&
      Boolean(network.observations[0].configuration),
  )
  await delay(10)
  for (now = 20; now <= IDLE_SPEAKER_MS; now += 20) {
    t.mock.timers.tick(20)
  }
  assert.deepEqual(ended, [{ code: null, reason: 'idle' }])
  await until(() => network.observations[0].closed)
  assert.equal(network.observations[0].frames.length, 0)
})
