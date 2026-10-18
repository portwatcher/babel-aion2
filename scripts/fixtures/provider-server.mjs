import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

// Responses are protocol fixtures, not evidence of provider accuracy or access.
export async function createProviderFixture() {
  const credentials = new Map()
  const observations = []
  const holds = new Map()
  const speechSockets = new Map()
  const listener = createServer(async (request, response) => {
    if (request.url !== '/v2/translate') {
      observations.push({ protocol: 'redirect' })
      response.writeHead(418).end()
      return
    }
    const key = request.headers.authorization?.replace('DeepL-Auth-Key ', '')
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const observation = {
      protocol: 'deepl',
      method: request.method,
      key,
      body,
      closed: false,
    }
    observations.push(observation)
    response.on('close', () => {
      observation.closed = true
    })
    const mode = credentials.get(key) ?? 'invalid'
    const hold = holds.get(key)
    hold?.started.resolve()
    if (hold) {
      await hold.finished.promise
    }
    if (mode === 'timeout') {
      return
    }
    if (mode === 'redirect') {
      response.writeHead(302, { location: `${origin}/leak` }).end()
      return
    }
    if (mode === 'malformed') {
      response.end('not JSON')
      return
    }
    if (mode === 'large') {
      response.end('x'.repeat(70_000))
      return
    }
    const status = { invalid: 403, quota: 456, rate: 429, model: 400 }[mode]
    response.setHeader('content-type', 'application/json')
    if (status) {
      // Deliberately unsafe upstream details must never escape the application.
      response.writeHead(status).end(JSON.stringify({ message: `upstream-${key}` }))
      return
    }
    response.end(
      JSON.stringify({
        translations: [
          {
            text: `fixture:${body.target_lang}${mode === 'echo' ? `:${body.text[0]}` : ''}`,
            detected_source_language: body.source_lang ?? 'EN',
          },
        ],
      }),
    )
  })
  const sockets = new WebSocketServer({
    server: listener,
    path: '/transcribe-websocket',
    maxPayload: 128 * 1024,
  })
  sockets.on('connection', (socket, request) => {
    const hash = createHash('sha256')
    const opened = performance.now()
    const [auth, key] =
      request.headers['sec-websocket-protocol']
        ?.split(',')
        .map((value) => value.trim()) ?? []
    const mode = credentials.get(key) ?? 'invalid'
    const observation = {
      protocol: 'soniox',
      auth,
      key,
      configuration: null,
      frames: [],
      end: false,
      closed: false,
    }
    observations.push(observation)
    speechSockets.set(key, socket)
    socket.on('close', () => {
      observation.closed = true
      if (speechSockets.get(key) === socket) {
        speechSockets.delete(key)
      }
    })
    if (mode === 'invalid' || mode === 'model' || mode === 'quota') {
      socket.send(
        JSON.stringify({
          error_code: mode === 'invalid' ? 401 : mode === 'quota' ? 402 : 400,
          error_type: mode === 'model' ? 'model_not_available' : undefined,
          error_message: `upstream-${key}`,
        }),
      )
      return
    }
    socket.on('message', (data, binary) => {
      if (binary) {
        hash.update(data)
        observation.frames.push({
          bytes: data.length,
          silence: data.every((value) => value === 0),
        })
        if (mode === 'speech') {
          const token = (text, is_final, times = {}) => ({
            text,
            is_final,
            translation_status: 'none',
            language: 'en',
            ...times,
          })
          const steps = [
            [token('Attack', false)],
            [token('Do not attack', false)],
            [
              token('Do not ', true, { start_ms: 0, end_ms: 180 }),
              token('attack', false),
            ],
            [
              token('attack', true, { start_ms: 180, end_ms: 320 }),
              token('<end>', true),
            ],
            [token('Wait 3', false)],
            [token('Wait 3 seconds.', true), token('<end>', true)],
          ]
          const tokens = steps[observation.frames.length - 1]
          if (tokens) {
            socket.send(JSON.stringify({ tokens }))
          }
        }
      } else if (data.length) {
        const message = JSON.parse(data.toString())
        if (message.type === 'keepalive') {
          return
        }
        observation.configuration = message
        if (mode === 'malformed') {
          socket.send('not JSON')
        }
        if (mode === 'early') {
          socket.send(JSON.stringify({ finished: true, total_audio_proc_ms: 0 }))
        }
      } else {
        observation.end = true
        observation.audioDigest = hash.digest('hex')
        observation.elapsedMs = performance.now() - opened
        if (mode !== 'timeout') {
          socket.send(
            JSON.stringify({
              finished: true,
              total_audio_proc_ms:
                (observation.frames.reduce((sum, frame) => sum + frame.bytes, 0) /
                  2 /
                  observation.configuration.sample_rate) *
                1000,
            }),
          )
        }
      }
    })
  })
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const origin = `http://127.0.0.1:${listener.address().port}`
  return {
    origin,
    observations,
    credential(mode = 'pass') {
      const key = `local-${randomUUID()}`
      credentials.set(key, mode)
      return key
    },
    setMode(key, mode) {
      credentials.set(key, mode)
    },
    transcript(key, tokens) {
      const socket = speechSockets.get(key)
      if (!socket) {
        throw new Error('No fixture recognition connection')
      }
      socket.send(JSON.stringify({ tokens }))
    },
    disconnect(key) {
      speechSockets.get(key)?.close()
    },
    hold(key) {
      const started = Promise.withResolvers()
      const finished = Promise.withResolvers()
      holds.set(key, { started, finished })
      return {
        started: started.promise,
        release() {
          finished.resolve()
          holds.delete(key)
        },
      }
    },
    async close() {
      for (const hold of holds.values()) {
        hold.finished.resolve()
      }
      for (const socket of sockets.clients) {
        socket.terminate()
      }
      await new Promise((resolve) => sockets.close(resolve))
      listener.closeAllConnections()
      await new Promise((resolve) => listener.close(resolve))
    },
  }
}
