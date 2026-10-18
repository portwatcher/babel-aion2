import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { RTCPeerConnection, MediaStreamTrack, RTCRtpCodecParameters } from 'werift'
import { startOpusSource } from './opus-source.mjs'

const peers = new Map()
const source = await startOpusSource((packet) => {
  for (const { peer, track } of peers.values()) {
    if (peer.connectionState === 'connected') {
      track.writeRtp(packet)
    }
  }
})
let origin
let stopping = false

async function closePeer(id) {
  const entry = peers.get(id)
  if (!entry) {
    return
  }
  peers.delete(id)
  entry.track.stop()
  await entry.peer.close()
  return { state: entry.peer.connectionState, signaling: entry.peer.signalingState }
}

const server = http.createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(await readFile(new URL('./browser.html', import.meta.url)))
      return
    }
    if (request.method !== 'POST' || request.headers.origin !== origin || stopping) {
      response.writeHead(403).end()
      return
    }
    if (request.url === '/offer') {
      if (peers.size >= 2 || source.failed()) {
        response.writeHead(503).end()
        return
      }
      const peer = new RTCPeerConnection({
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
      const track = new MediaStreamTrack({ kind: 'audio' })
      const id = randomUUID()
      peers.set(id, { peer, track })
      peer.addTransceiver(track, { direction: 'sendonly' })
      try {
        await peer.setLocalDescription(await peer.createOffer())
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id, description: peer.localDescription }))
      } catch {
        await closePeer(id)
        response.writeHead(500).end()
      }
      return
    }
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 100_000) {
        response.writeHead(413).end()
        return
      }
    }
    const input = JSON.parse(body || '{}')
    const entry = peers.get(input.id)
    if (!entry) {
      response.writeHead(404).end()
      return
    }
    if (request.url === '/answer') {
      await entry.peer.setRemoteDescription(input.description)
      response.writeHead(204).end()
    } else if (request.url === '/close') {
      const result = await closePeer(input.id)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(result))
    } else {
      response.writeHead(404).end()
    }
  } catch {
    response.writeHead(500).end('Probe failed')
  }
})
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`
  console.log(JSON.stringify({ origin, pid: process.pid, syntheticAudio: true }))
})
async function stop() {
  if (stopping) {
    return
  }
  stopping = true
  clearTimeout(lifetime)
  await Promise.all([...peers.keys()].map(closePeer))
  await source.close()
  server.close()
}
const lifetime = setTimeout(() => void stop(), 15 * 60_000)
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => void stop())
}
