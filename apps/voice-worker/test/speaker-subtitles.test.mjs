import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { SpeakerSubtitles } from '../src/speaker-subtitles.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'

async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!predicate() && Date.now() < deadline) {
    await delay(5)
  }
  assert.ok(predicate(), 'provider received the expected audio')
}

for (const callbackMs of [20, 21]) {
  test(`subtitle audio keeps real-time pace with ${callbackMs} ms interval callbacks`, async (t) => {
    const network = await createProviderFixture()
    const restore = routeProviderNetwork(network.origin)
    t.after(async () => {
      restore()
      await network.close()
    })
    let now = 0
    t.mock.method(performance, 'now', () => now)
    t.mock.timers.enable({ apis: ['setInterval'] })
    const settings = { type: 'openai', timeoutMs: 3000 }
    const provider = { settings, credential: network.credential() }
    const path = {
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
    const failures = []
    const speaker = new SpeakerSubtitles(
      '00000000-0000-4000-8000-000000000001',
      1,
      1,
      'host',
      () => 'Host',
      path.group,
      path,
      () => true,
      (code) => failures.push(code),
    )
    t.after(() => speaker.close())
    speaker.reconcile(
      [{ id: 'listener', outputLanguage: 'ja', deliver() {} }],
      new Map([['ja', path]]),
    )
    await until(
      () =>
        network.observations.length === 2 &&
        network.observations.every((value) => value.configuration),
    )
    // Allow the real socket's session.updated acknowledgement to reach the worker.
    await delay(10)
    const speech = Buffer.alloc(3840)
    for (let offset = 0; offset < speech.length; offset += 2) {
      speech.writeInt16LE(4000, offset)
    }
    // Hardware produces 20 ms frames; a slightly late interval must not build
    // an ever-growing queue and repeatedly destroy both provider sessions.
    for (now = 1; now <= 3200; now += 1) {
      if (now <= 3000 && now % 20 === 0) {
        speaker.receive(speech)
      }
      if (now % callbackMs === 0) {
        t.mock.timers.tick(20)
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    assert.deepEqual(failures, [], 'normal timer drift must not restart recognition')
    await until(() => network.observations.every((value) => value.frames.length >= 159))
    for (const connection of network.observations) {
      assert.ok(connection.frames.length <= 160, 'audio does not run ahead of time')
      assert.ok(
        connection.frames.filter((frame) => !frame.silence).length >= 149,
        'continuous speech reaches both provider sessions without dropping frames',
      )
      assert.ok(
        connection.frames.slice(-5).every((frame) => frame.silence),
        'real pauses remain silent',
      )
      assert.equal(connection.closed, false)
    }
    // An actual stall still retires the stream instead of replaying old commands.
    now += 200
    t.mock.timers.tick(20)
    assert.deepEqual(failures, ['UNAVAILABLE'])
  })
}
