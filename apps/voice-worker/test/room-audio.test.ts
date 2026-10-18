import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import opus from '@discordjs/opus'
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

function receiver(t: TestContext, allowed = () => true) {
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
  async function waitFor(count: number) {
    const deadline = Date.now() + 2_000
    while (frames.length < count && Date.now() < deadline) {
      await delay(5)
    }
    assert.equal(failed, false)
    assert.ok(frames.length >= count, 'Opus publication did not reach the receiver')
    assert.ok(frames.every((frame) => frame.length === 960 * 2 * 2))
  }
  return { audio, frames, waitFor }
}

test('playback mixes independent stereo speakers and assembles short frames without losing a real pause', async (t) => {
  const r = receiver(t)
  for (let half = 0; half < 6; half += 1) {
    r.audio.receive('one', tone(1_000, 10, 0))
    r.audio.receive('two', tone(2_000, 10, 1))
  }
  await r.waitFor(3)
  const audible = Buffer.concat(r.frames.slice(0, 3))
  assert.ok(energy(audible, 1_000, 0) > 1_000)
  assert.ok(energy(audible, 2_000, 1) > 1_000)
  assert.ok(energy(audible, 2_000, 0) < 200)
  assert.ok(energy(audible, 1_000, 1) < 200)
  await r.waitFor(10)
  const pause = Buffer.concat(r.frames.slice(8, 10))
  assert.ok(energy(pause, 1_000, 0) < 100)
  assert.ok(energy(pause, 2_000, 1) < 100)
})

test('backlog drops old sound, retains only 100 ms, and no output survives loss of permission or close', async (t) => {
  let allowed = true
  const r = receiver(t, () => allowed)
  r.audio.receive('one', Buffer.concat([tone(400, 400), tone(3_000, 100)]))
  await r.waitFor(3)
  const current = Buffer.concat(r.frames.slice(0, 3))
  assert.ok(energy(current, 3_000, 0) > 2_000)
  assert.ok(energy(current, 400, 0) < 100)
  allowed = false
  const count = r.frames.length
  r.audio.receive('one', tone(400, 100))
  await delay(60)
  assert.equal(r.frames.length, count)
  allowed = true
  await r.waitFor(count + 6)
  assert.ok(energy(Buffer.concat(r.frames.slice(-2)), 400, 0) < 100)
  r.audio.close()
  const closedCount = r.frames.length
  r.audio.receive('one', tone(400, 100))
  await delay(60)
  assert.equal(r.frames.length, closedCount)
})
