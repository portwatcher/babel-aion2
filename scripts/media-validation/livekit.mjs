import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import {
  Room,
  RoomEvent,
  AudioSource,
  AudioFrame,
  AudioStream,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from '@livekit/rtc-node'

// The compose network has no published ports. These are public development
// fixture credentials, never user credentials. This probe does not read .env.
const endpoint = 'http://livekit:17880'
const socketEndpoint = 'ws://livekit:17880'
const fixtureKey = 'local-media-validation'
const fixtureSecret = 'local-media-validation-only-not-a-secret'
const service = new RoomServiceClient(endpoint, fixtureKey, fixtureSecret)
const roomName = `babel-probe-${randomUUID()}`
const publisher = new Room()
const receiver = new Room()
const rejoin = new Room()
const fresh = new Room()
const source = new AudioSource(48000, 1, 50)
const track = LocalAudioTrack.createAudioTrack('synthetic-440hz', source)
let reader
let readTask
let frames = 0
let peak = 0
let offset = 0
let stage = 'create-room'
let result

async function token(identity, publish) {
  const access = new AccessToken(fixtureKey, fixtureSecret, { identity, ttl: 300 })
  access.addGrant({
    roomJoin: true,
    room: roomName,
    canSubscribe: !publish,
    canPublish: publish,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  })
  return access.toJwt()
}

try {
  await service.createRoom({ name: roomName, emptyTimeout: 30 })
  stage = 'connect-publisher'
  await publisher.connect(socketEndpoint, await token('publisher', true))
  const receivedTrack = once(receiver, RoomEvent.TrackSubscribed, {
    signal: AbortSignal.timeout(15_000),
  })
  // Observe early rejection immediately, then await the same promise below.
  void receivedTrack.catch(() => {})
  const receiverToken = await token('listener', false)
  stage = 'connect-receiver'
  await receiver.connect(socketEndpoint, receiverToken)
  const options = new TrackPublishOptions()
  options.source = TrackSource.SOURCE_MICROPHONE
  stage = 'publish'
  await publisher.localParticipant.publishTrack(track, options)
  const [remoteTrack] = await receivedTrack
  reader = new AudioStream(remoteTrack, {
    sampleRate: 48000,
    numChannels: 1,
    frameSizeMs: 10,
  }).getReader()
  readTask = (async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        return
      }
      frames += 1
      for (const sample of next.value.data) {
        peak = Math.max(peak, Math.abs(sample))
      }
    }
  })()
  void readTask.catch(() => {})
  stage = 'capture'
  for (let frame = 0; frame < 120; frame += 1) {
    const samples = new Int16Array(480)
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.round(
        600 * Math.sin((2 * Math.PI * 440 * offset++) / 48000),
      )
    }
    // The buffer remains owned until asynchronous native capture completes.
    await source.captureFrame(new AudioFrame(samples, 48000, 1, 480))
    await delay(10)
  }
  await source.waitForPlayout()
  const deadline = Date.now() + 5_000
  while ((frames < 50 || peak < 100) && Date.now() < deadline) {
    await delay(20)
  }
  assert.ok(frames >= 50 && peak >= 100)
  stage = 'remove'
  const disconnected = once(receiver, RoomEvent.Disconnected, {
    signal: AbortSignal.timeout(10_000),
  })
  void disconnected.catch(() => {})
  await service.removeParticipant(roomName, 'listener')
  await disconnected
  assert.ok(
    !(await service.listParticipants(roomName)).some((p) => p.identity === 'listener'),
  )
  await reader.cancel()
  await readTask
  reader = undefined
  stage = 'old-token-rejoin'
  let oldTokenDenied = false
  try {
    await rejoin.connect(socketEndpoint, receiverToken)
  } catch (error) {
    // A timeout, ICE failure or server outage does not prove token rejection.
    oldTokenDenied = /401|403|unauthoriz|permission denied|invalid token/i.test(
      String(error?.message),
    )
  }
  const oldTokenRejoined =
    rejoin.isConnected &&
    (await service.listParticipants(roomName)).some((p) => p.identity === 'listener')
  if (oldTokenDenied) {
    stage = 'fresh-token-control'
    await fresh.connect(socketEndpoint, await token('listener', false))
  }
  const revoked = oldTokenDenied && !oldTokenRejoined && fresh.isConnected
  result = {
    status: revoked ? 'PASS' : 'FAIL',
    media: 'PASS',
    decodedFrames: frames,
    decodedPeak: peak,
    removedConnection: 'PASS',
    oldTokenRejoined,
    revocation: revoked ? 'PASS' : oldTokenRejoined ? 'FAIL' : 'NOT PROVEN',
  }
  // This command is deliberately a failing revocation gate, not a test that
  // reports PASS because it successfully demonstrated an unsafe assumption.
  process.exitCode = revoked ? 0 : 1
} catch {
  result = { status: 'FAIL', stage, revocation: 'NOT PROVEN' }
  process.exitCode = 1
} finally {
  await reader?.cancel()
  await readTask
  await Promise.all([
    receiver.disconnect(),
    rejoin.disconnect(),
    fresh.disconnect(),
    publisher.disconnect(),
  ])
  await track.close()
  await source.close()
  await service.deleteRoom(roomName)
  await dispose()
}
process.send?.(result)
process.disconnect?.()
