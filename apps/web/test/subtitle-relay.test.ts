import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { ListenerSnapshot, PlayerEvent, SubtitleMessage } from '@babel/contracts'
import { createSubtitleRelay } from '../server/utils/subtitle-relay.ts'

const roomId = randomUUID()
const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const message: SubtitleMessage = {
  type: 'subtitle',
  value: {
    roomId,
    sourceGeneration: 1,
    streamGeneration: 1,
    speakerId: 'speaker',
    speakerDisplayName: 'Speaker',
    utteranceId: randomUUID(),
    sourceRevision: 1,
    translationRevision: 1,
    sequence: 1,
    sourceLanguage: 'en',
    originalText: 'Hold.',
    outputLanguage: 'ja',
    translatedText: '待って。',
    sourceIsFinal: false,
    translationIsFinal: false,
    configurationVersion: 1,
    audioStartMs: null,
    audioEndMs: null,
    serverSentAt: new Date().toISOString(),
    discontinuity: false,
    failure: null,
    latency: { traceparent, speechStartedAt: Date.now() - 900, attribution: 'clean' },
  },
}

test('the relay passes trace context to the server only, never in the browser event', async () => {
  const worker = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/x-ndjson' })
    response.write(`${JSON.stringify(message)}\n`)
  })
  worker.listen(0, '127.0.0.1')
  await once(worker, 'listening')
  const { port } = worker.address() as AddressInfo
  Object.assign(globalThis, {
    useRuntimeConfig: () => ({
      mediaControlUrl: `http://127.0.0.1:${port}`,
      mediaControlSecret: 'x'.repeat(32),
    }),
  })
  const received = Promise.withResolvers<{
    event: PlayerEvent
    latency: unknown
  }>()
  const relay = createSubtitleRelay(randomUUID(), (event, latency) => {
    if (event.type === 'subtitles' && event.event.type === 'subtitle') {
      received.resolve({ event, latency })
    }
  })
  const session: ListenerSnapshot = {
    sessionId: randomUUID(),
    nicknameGeneration: 1,
    roomId,
    nickname: 'listener',
    state: 'ACTIVE',
    terminalReason: null,
    outputLanguage: 'ja',
    subscriptionVersion: 1,
    joinedAt: new Date().toISOString(),
  }
  relay.update(session)
  try {
    const { event, latency } = await received.promise
    assert.doesNotMatch(JSON.stringify(event), /traceparent|speechStartedAt/u)
    assert.deepEqual(
      (latency as { value: unknown }).value,
      message.type === 'subtitle' ? message.value.latency : null,
    )
  } finally {
    relay.stop()
    worker.closeAllConnections()
    worker.close()
  }
})
