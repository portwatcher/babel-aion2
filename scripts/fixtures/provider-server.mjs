import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { WebSocketServer } from 'ws'

const exec = promisify(execFile)

async function ephemeralTlsCredentials() {
  const dir = await mkdtemp(join(tmpdir(), 'babel-provider-tls-'))
  try {
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    await exec('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=api.openai.com',
      '-addext',
      'subjectAltName=DNS:api.openai.com,IP:127.0.0.1',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ])
    const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])
    return { key, cert }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function extractTargetLanguage(messages) {
  const system = messages?.find((message) => message.role === 'system')?.content ?? ''
  const match = /\(([A-Za-z0-9-]+)\)\.\s+Output ONLY/u.exec(system)
  if (!match) {
    return 'und'
  }
  try {
    return new Intl.Locale(match[1]).language
  } catch {
    return 'und'
  }
}

// Deliberately synthetic wire responses, never a provider-quality benchmark.
export async function createProviderFixture(options = {}) {
  const credentials = new Map()
  const observations = []
  const connections = new Map()
  const httpResponses = new Map()
  const emitters = new Map()
  const holds = new Map()
  const tls = options.tls ? await ephemeralTlsCredentials() : null

  const handleRequest = (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const key = request.headers.authorization?.replace('Bearer ', '')
    const mode = credentials.get(key) ?? 'invalid'
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      let body = null
      try {
        body = JSON.parse(raw)
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'invalid_request_error' } }))
        return
      }
      const observation = {
        protocol: 'translation',
        key,
        url: url.pathname,
        auth: request.headers.authorization,
        configuration: body,
        model: body.model,
        stream: Boolean(body.stream),
        messages: body.messages,
        closed: false,
      }
      observations.push(observation)
      httpResponses.set(observation, response)
      response.on('close', () => {
        observation.closed = true
        httpResponses.delete(observation)
      })

      const respond = () => {
        if (response.destroyed || response.writableEnded) {
          return
        }
        if (mode === 'timeout') {
          return
        }
        const errorSpec = {
          invalid: [401, 'invalid_api_key'],
          quota: [429, 'insufficient_quota'],
          model: [404, 'model_not_found'],
          rate: [429, 'rate_limit_exceeded'],
          permission: [403, 'permission_denied'],
        }[mode]
        if (errorSpec) {
          const [status, code] = errorSpec
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { code, message: 'unsafe-' + key } }))
          return
        }
        if (!body.stream) {
          if (mode === 'malformed') {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end('not JSON')
            return
          }
          if (mode === 'early') {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end('')
            return
          }
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              id: 'chatcmpl-' + randomUUID(),
              choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
            }),
          )
          return
        }
        if (!response.headersSent) {
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
        }
        if (mode === 'malformed') {
          response.end('data: not JSON\n\n')
          return
        }
        if (mode === 'early') {
          response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
          return
        }
        const language = extractTargetLanguage(body.messages)
        const userText =
          body.messages?.find((message) => message.role === 'user')?.content ?? ''
        const first = `fixture:${language}:`
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: first } }] })}\n\n`,
        )
        if (userText) {
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: userText } }] })}\n\n`,
          )
        }
        response.end('data: [DONE]\n\n')
      }

      const held = holds.get(key)
      if (held && held.protocol === 'translation') {
        if (body.stream && !held.configuration && mode !== 'timeout') {
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          response.flushHeaders()
        }
        held.started.resolve()
        held.pending.push(respond)
      } else {
        respond()
      }
    })
  }
  const listener = tls
    ? createTlsServer({ key: tls.key, cert: tls.cert }, handleRequest)
    : createServer(handleRequest)

  const sockets = new WebSocketServer({ server: listener, maxPayload: 128 * 1024 })
  sockets.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost')
    const protocol = 'recognition'
    const key = request.headers.authorization?.replace('Bearer ', '')
    const mode = credentials.get(key) ?? 'invalid'
    const observation = {
      protocol,
      key,
      url: url.pathname + url.search,
      auth: request.headers.authorization,
      configuration: null,
      frames: [],
      cleared: 0,
      end: false,
      closed: false,
    }
    observations.push(observation)
    connections.set(observation, socket)
    const started = performance.now()
    let item = 1
    let itemSpeechFrames = 0
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
        if (event.session.audio?.input?.transcription?.prompt?.length > 1024) {
          socket.send(
            JSON.stringify({
              type: 'error',
              error: { code: 'string_above_max_length' },
            }),
          )
          return
        }
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
      } else if (event.type === 'input_audio_buffer.append') {
        const bytes = Buffer.from(event.audio, 'base64')
        const silence = bytes.every((value) => value === 0)
        observation.frames.push({
          bytes: bytes.length,
          silence,
        })
        if (!silence) {
          itemSpeechFrames += 1
        }
        if (mode === 'speech' || mode === 'echo' || mode === 'sentences') {
          if (item === 1 && !silence && itemSpeechFrames <= 2) {
            const delta = itemSpeechFrames === 1 ? 'Wait ' : '3 seconds.'
            text += delta
            emit({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'item_' + item,
              delta,
            })
          } else if (
            mode === 'sentences' &&
            item === 2 &&
            !silence &&
            itemSpeechFrames === 1
          ) {
            const delta = 'Do not attack.'
            text += delta
            emit({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'item_' + item,
              delta,
            })
          }
        }
      } else if (event.type === 'input_audio_buffer.clear') {
        observation.cleared += 1
        itemSpeechFrames = 0
        text = ''
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
        itemSpeechFrames = 0
        text = ''
      }
    })
  })
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const origin = `${tls ? 'https' : 'http'}://127.0.0.1:${listener.address().port}`
  return {
    origin,
    ca: tls?.cert,
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
      for (const [observation, response] of httpResponses) {
        if (observation.key === key) {
          response.socket?.destroy()
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
      for (const response of httpResponses.values()) {
        response.destroy()
      }
      await new Promise((resolve) => sockets.close(resolve))
      listener.closeAllConnections()
      await new Promise((resolve) => listener.close(resolve))
    },
  }
}
