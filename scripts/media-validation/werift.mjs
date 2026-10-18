import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { RTCPeerConnection, MediaStreamTrack, RTCRtpCodecParameters } from 'werift'
import { startOpusSource } from './opus-source.mjs'

const sender = new RTCPeerConnection({
  iceServers: [],
  iceUseIpv6: false,
  codecs: {
    audio: [
      new RTCRtpCodecParameters({
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
        payloadType: 111,
      }),
    ],
  },
})
const receiver = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
const track = new MediaStreamTrack({ kind: 'audio' })
let received = 0
let bytes = 0
let source
let result
let stage = 'negotiate'

try {
  receiver.onTrack.subscribe((remote) => {
    remote.onReceiveRtp.subscribe((packet) => {
      received += 1
      bytes += packet.payload.length
    })
  })
  sender.addTransceiver(track, { direction: 'sendonly' })
  await sender.setLocalDescription(await sender.createOffer())
  await receiver.setRemoteDescription(sender.localDescription)
  await receiver.setLocalDescription(await receiver.createAnswer())
  await sender.setRemoteDescription(receiver.localDescription)
  stage = 'receive-rtp'
  source = await startOpusSource((packet) => {
    if (sender.connectionState === 'connected') {
      track.writeRtp(packet)
    }
  })
  const deadline = Date.now() + 10_000
  while (received < 50 && Date.now() < deadline && !source.failed()) {
    await delay(20)
  }
  assert.ok(received >= 50 && bytes > 1_000)
  stage = 'close-sender'
  track.stop()
  await sender.close()
  assert.equal(sender.connectionState, 'closed')
  // Keep the source and receiver running. A receiver-side close would conceal a
  // sender that continued transmitting. Allow only already-in-flight packets.
  await delay(500)
  const afterDrain = received
  await delay(1_500)
  assert.equal(received, afterDrain)
  result = { status: 'PASS', received, bytes, senderClosed: true, packetsStopped: true }
} catch {
  result = { status: 'FAIL', stage }
  process.exitCode = 1
} finally {
  await source?.close()
  track.stop()
  await Promise.all([sender.close(), receiver.close()])
}
process.send?.(result)
process.disconnect?.()
