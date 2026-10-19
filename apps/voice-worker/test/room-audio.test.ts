import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { performance } from 'node:perf_hooks'
import opus from '@discordjs/opus'
import { GuildBroadcast } from '../src/guild-broadcast.ts'
import type { VoiceSourceConfiguration } from '@babel/database/voice-sources'
import { RoomAudio } from '../src/room-audio.ts'

function tone(frequency: number, durationMs: number, channel?: number) {
  const pcm = Buffer.alloc(durationMs * 48 * 4)
  for (let sample = 0; sample < durationMs * 48; sample += 1) {
    const value = Math.round(
      12_000 * Math.sin((2 * Math.PI * frequency * sample) / 48_000),
    )
    for (let c = 0; c < 2; c += 1) {
      pcm.writeInt16LE(
        channel === undefined || c === channel ? value : 0,
        sample * 4 + c * 2,
      )
    }
  }
  return pcm
}

function energy(pcm: Buffer, frequency: number, channel: number) {
  let real = 0
  let imaginary = 0
  for (let sample = 0; sample < pcm.length / 4; sample += 1) {
    const phase = (2 * Math.PI * frequency * sample) / 48_000
    const value = pcm.readInt16LE(sample * 4 + channel * 2)
    real += value * Math.cos(phase)
    imaginary += value * Math.sin(phase)
  }
  return Math.hypot(real, imaginary) / (pcm.length / 4)
}

/** Drives the 20 ms playback interval and its monotonic clock without scheduler delay. */
function playbackClock(t: TestContext) {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setInterval'] })
  return (durationMs: number) => {
    for (let elapsed = 0; elapsed < durationMs; elapsed += 20) {
      now += 20
      t.mock.timers.tick(20)
    }
  }
}

function receiver(t: TestContext, allowed = () => true) {
  const advance = playbackClock(t)
  const decoder = new opus.OpusEncoder(48_000, 2)
  const frames: Buffer[] = []
  let failed = false
  const audio = new RoomAudio(
    allowed,
    (packet) => {
      frames.push(Buffer.from(decoder.decode(packet)))
    },
    () => {
      failed = true
    },
  )
  t.after(() => audio.close())
  function play(count: number) {
    const before = frames.length
    advance(count * 20)
    assert.equal(failed, false)
    assert.equal(
      frames.length,
      before + count,
      'Opus publication did not reach the receiver',
    )
    assert.ok(frames.every((frame) => frame.length === 960 * 2 * 2))
  }
  return { audio, frames, advance, play }
}

test('playback mixes independent stereo speakers and assembles short frames without losing a real pause', (t) => {
  const r = receiver(t)
  for (let half = 0; half < 6; half += 1) {
    r.audio.receive('one', tone(1_000, 10, 0))
    r.audio.receive('two', tone(2_000, 10, 1))
  }
  r.play(3)
  const audible = Buffer.concat(r.frames.slice(0, 3))
  assert.ok(energy(audible, 1_000, 0) > 1_000)
  assert.ok(energy(audible, 2_000, 1) > 1_000)
  assert.ok(energy(audible, 2_000, 0) < 200)
  assert.ok(energy(audible, 1_000, 1) < 200)
  r.play(7)
  const pause = Buffer.concat(r.frames.slice(8, 10))
  assert.ok(energy(pause, 1_000, 0) < 100)
  assert.ok(energy(pause, 2_000, 1) < 100)
})

test('backlog drops old sound, retains only 100 ms, and no output survives loss of permission or close', (t) => {
  let allowed = true
  const r = receiver(t, () => allowed)
  r.audio.receive('one', Buffer.concat([tone(400, 400), tone(3_000, 100)]))
  r.play(3)
  const current = Buffer.concat(r.frames.slice(0, 3))
  assert.ok(energy(current, 3_000, 0) > 2_000)
  assert.ok(energy(current, 400, 0) < 100)
  allowed = false
  const count = r.frames.length
  r.audio.receive('one', tone(400, 100))
  r.advance(60)
  assert.equal(r.frames.length, count)
  allowed = true
  r.play(6)
  assert.ok(energy(Buffer.concat(r.frames.slice(-2)), 400, 0) < 100)
  r.audio.close()
  const closedCount = r.frames.length
  r.audio.receive('one', tone(400, 100))
  r.advance(60)
  assert.equal(r.frames.length, closedCount)
})

test('one guild broadcast delivers real Opus to independent rooms and retires only stopped destinations', async (t) => {
  const frames = new Map<string, Buffer[]>()
  const decoders = new Map<string, InstanceType<typeof opus.OpusEncoder>>()
  const retired = new Set<string>()
  const captions = new Map<string, string[]>()
  const room = (id: string, stopped = false): VoiceSourceConfiguration => ({
    id,
    stopped,
    name: id,
    discordGuildId: '10000000000000001',
    discordVoiceChannelId: '10000000000000002',
    encryptedDiscordCredential: 'fixture',
    captureMode: 'ALL_CHANNEL',
    commanderIds: [],
    sourceGeneration: 1,
    configurationVersion: 1,
    defaultOutputLanguage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  let allowed = true
  const advance = playbackClock(t)
  const broadcast = new GuildBroadcast(
    () => allowed,
    {
      publish(roomId, packet) {
        let decoder = decoders.get(roomId)
        if (!decoder) {
          decoder = new opus.OpusEncoder(48_000, 2)
          decoders.set(roomId, decoder)
        }
        const received = frames.get(roomId) ?? []
        received.push(Buffer.from(decoder.decode(packet)))
        frames.set(roomId, received)
      },
      async closeRoom(roomId) {
        retired.add(roomId)
      },
    },
    {
      source(roomId, _generation, permitted) {
        const received: string[] = []
        captions.set(roomId, received)
        return {
          receive(_id, name) {
            if (permitted()) {
              received.push(name)
            }
          },
          remove() {},
          close() {},
        }
      },
    },
    () => assert.fail('audio encoding failed'),
  )
  t.after(() => broadcast.close())
  await broadcast.reconcile([room('one'), room('two')])
  broadcast.receive('commander', 'Commander', tone(1_000, 60))
  const play = (count: number) => {
    const before = frames.get('two')?.length ?? 0
    advance(count * 20)
    assert.equal(frames.get('two')?.length ?? 0, before + count)
  }
  play(3)
  for (const roomId of ['one', 'two']) {
    assert.ok(energy(Buffer.concat(frames.get(roomId)!.slice(0, 3)), 1_000, 0) > 1_000)
    assert.deepEqual(captions.get(roomId), ['Commander'])
  }
  await broadcast.reconcile([room('one', true), room('two')])
  const count = frames.get('one')!.length
  broadcast.receive('commander', 'Still live', tone(2_000, 60))
  play(3)
  assert.equal(frames.get('one')!.length, count)
  assert.deepEqual([...retired], ['one'])
  assert.deepEqual(captions.get('one'), ['Commander'])
  assert.deepEqual(captions.get('two'), ['Commander', 'Still live'])
  assert.ok(energy(Buffer.concat(frames.get('two')!.slice(-3)), 2_000, 0) > 1_000)
  allowed = false
  const ended = frames.get('two')!.length
  broadcast.receive('commander', 'Obsolete', tone(400, 60))
  advance(60)
  assert.equal(frames.get('two')!.length, ended)
})
