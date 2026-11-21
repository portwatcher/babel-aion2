import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { IDLE_SPEAKER_MS, SpeakerSubtitles } from '../src/speaker-subtitles.ts'
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
    // 120 ms (6 frames) of hangover reach OpenAI, then VAD stops sending silence.
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
    await until(() => recognition.frames.length >= 155)
    assert.ok(recognition.frames.length <= 157, 'silence after hangover is gated')
    assert.ok(
      recognition.frames.filter((frame) => !frame.silence).length >= 149,
      'continuous speech reaches recognition without dropping frames',
    )
    assert.equal(
      recognition.frames.slice(-5).every((frame) => frame.silence),
      true,
      '120 ms trailing hangover preserves utterance boundary after filter tail',
    )
    assert.equal(recognition.closed, false)
    // An actual stall still retires the stream instead of replaying old commands.
    now += 200
    t.mock.timers.tick(20)
    assert.deepEqual(ended, [{ code: 'UNAVAILABLE', reason: 'clock-stall' }])
  })
}

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
