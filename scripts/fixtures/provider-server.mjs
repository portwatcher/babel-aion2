import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

// Responses are protocol fixtures, not evidence of provider accuracy or access.
export async function createProviderFixture() {
  const credentials = new Map()
  const observations = []
  const holds = new Map()
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
    observations.push({ protocol: 'deepl', method: request.method, key, body })
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
            text: `fixture:${body.target_lang}`,
            detected_source_language: body.source_lang,
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
    }
    observations.push(observation)
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
        observation.frames.push({
          bytes: data.length,
          silence: data.every((value) => value === 0),
        })
      } else if (data.length) {
        observation.configuration = JSON.parse(data.toString())
        if (mode === 'malformed') {
          socket.send('not JSON')
        }
        if (mode === 'early') {
          socket.send(JSON.stringify({ finished: true, total_audio_proc_ms: 0 }))
        }
      } else {
        observation.end = true
        if (mode !== 'timeout') {
          socket.send(
            JSON.stringify({
              finished: true,
              total_audio_proc_ms: observation.frames.length * 20,
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
