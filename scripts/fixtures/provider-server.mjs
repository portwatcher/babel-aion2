import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

// Deliberately synthetic wire responses, never a provider-quality benchmark.
export async function createProviderFixture() {
  const credentials = new Map()
  const observations = []
  const connections = new Map()
  const emitters = new Map()
  const holds = new Map()
  const listener = createServer((_request, response) => response.writeHead(404).end())
  const sockets = new WebSocketServer({ server: listener, maxPayload: 128 * 1024 })
  sockets.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost')
    const protocol = url.pathname.endsWith('/translations')
      ? 'translation'
      : 'recognition'
    const key = request.headers.authorization?.replace('Bearer ', '')
    const mode = credentials.get(key) ?? 'invalid'
    const observation = {
      protocol,
      key,
      url: url.pathname + url.search,
      auth: request.headers.authorization,
      configuration: null,
      frames: [],
      end: false,
      closed: false,
    }
    observations.push(observation)
    connections.set(observation, socket)
    const started = performance.now()
    let item = 1
    let text = ''
    const emit = (event) => {
      const held = holds.get(key)
      if (held && held.protocol === protocol) {
        held.started.resolve()
        held.pending.push(() => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(event))
          }
        })
      } else if (socket.readyState === 1) {
        socket.send(JSON.stringify(event))
      }
    }
    emitters.set(observation, emit)
    socket.on('close', () => {
      observation.closed = true
      connections.delete(observation)
      emitters.delete(observation)
    })
    socket.send(
      JSON.stringify({
        type: 'session.created',
        session: { expires_at: Math.floor(Date.now() / 1000) + 3600 },
      }),
    )
    socket.on('message', (raw, binary) => {
      if (binary) {
        socket.close(1003)
        return
      }
      const event = JSON.parse(raw.toString())
      if (event.type === 'session.update') {
        observation.configuration = event.session
        if (mode === 'timeout') {
          return
        }
        if (mode === 'malformed') {
          socket.send('not JSON')
          return
        }
        if (mode === 'early') {
          socket.send(JSON.stringify({ type: 'session.closed' }))
          return
        }
        const code = {
          invalid: 'invalid_api_key',
          quota: 'insufficient_quota',
          model: 'model_not_found',
          rate: 'rate_limit_exceeded',
          permission: 'permission_denied',
        }[mode]
        if (code) {
          socket.send(
            JSON.stringify({
              type: 'error',
              error: { code, message: 'unsafe-' + key },
            }),
          )
          return
        }
        if (holds.get(key)?.configuration) {
          emit({ type: 'session.updated', session: event.session })
        } else {
          socket.send(
            JSON.stringify({ type: 'session.updated', session: event.session }),
          )
        }
      } else if (
        event.type === 'input_audio_buffer.append' ||
        event.type === 'session.input_audio_buffer.append'
      ) {
        const bytes = Buffer.from(event.audio, 'base64')
        observation.frames.push({
          bytes: bytes.length,
          silence: bytes.every((value) => value === 0),
        })
        if (mode === 'speech' || mode === 'echo' || mode === 'sentences') {
          if (protocol === 'recognition' && observation.frames.length <= 2) {
            const delta = observation.frames.length === 1 ? 'Wait ' : '3 seconds.'
            text += delta
            emit({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'item_' + item,
              delta,
            })
          }
          if (protocol === 'translation' && observation.frames.length <= 2) {
            const language = observation.configuration.audio.output.language
            emit({
              type: 'session.output_transcript.delta',
              event_id: randomUUID(),
              elapsed_ms: 200,
              delta:
                observation.frames.length === 1
                  ? 'fixture:' + language + ':'
                  : 'Wait 3 seconds.',
            })
          }
        }
        if (
          mode === 'sentences' &&
          protocol === 'translation' &&
          observation.frames.length === 3
        ) {
          emit({
            type: 'session.output_transcript.delta',
            event_id: randomUUID(),
            elapsed_ms: 400,
            delta: 'Do not attack.',
          })
        }
      } else if (event.type === 'input_audio_buffer.commit') {
        observation.elapsedMs = performance.now() - started
        observation.end = true
        emit({ type: 'input_audio_buffer.committed', item_id: 'item_' + item })
        emit({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item_' + item,
          transcript: text,
        })
        item += 1
        text = ''
      } else if (event.type === 'session.close') {
        observation.elapsedMs = performance.now() - started
        observation.end = true
        emit({ type: 'session.closed', event_id: randomUUID() })
      }
    })
  })
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const origin = 'http://127.0.0.1:' + listener.address().port
  return {
    origin,
    observations,
    credential(mode = 'pass') {
      const key = 'local-' + randomUUID()
      credentials.set(key, mode)
      return key
    },
    setMode(key, mode) {
      credentials.set(key, mode)
    },
    emit(key, event, observation) {
      const selected =
        observation ?? [...connections.keys()].find((value) => value.key === key)
      const socket = connections.get(selected)
      if (!socket) {
        throw new Error('No fixture provider connection')
      }
      emitters.get(selected)(event)
    },
    disconnect(key) {
      for (const [observation, socket] of connections) {
        if (observation.key === key) {
          socket.close()
        }
      }
    },
    hold(key, protocol = 'translation', configuration = false) {
      const started = Promise.withResolvers()
      const hold = { protocol, configuration, started, pending: [] }
      holds.set(key, hold)
      return {
        started: started.promise,
        release() {
          holds.delete(key)
          for (const send of hold.pending) {
            send()
          }
        },
      }
    },
    async close() {
      holds.clear()
      for (const socket of sockets.clients) {
        socket.terminate()
      }
      await new Promise((resolve) => sockets.close(resolve))
      listener.closeAllConnections()
      await new Promise((resolve) => listener.close(resolve))
    },
  }
}
