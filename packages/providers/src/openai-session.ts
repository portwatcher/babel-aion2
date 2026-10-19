import WebSocket from 'ws'
import {
  openaiSettingsSchema,
  providerCredentialSchema,
  type OpenAISettings,
} from '@babel/contracts'
import { ProviderFailure, openaiFailure } from './errors.ts'

export interface OpenAIEvent {
  type: string
  [key: string]: unknown
}

/** Fixed official destinations; the key appears only in server handshake headers. */
export function openOpenAISession(input: {
  settings: OpenAISettings
  credential: string
  translation: boolean
  configuration: Record<string, unknown>
  signal?: AbortSignal
  event: (event: OpenAIEvent) => void
}) {
  if (
    !openaiSettingsSchema.safeParse(input.settings).success ||
    !providerCredentialSchema.safeParse(input.credential).success
  ) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  const ready = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  void ready.promise.catch(() => {})
  void finished.promise.catch(() => {})
  let closed = false
  let configured = false
  let ending = false
  let expires: ReturnType<typeof setTimeout> | undefined
  let pong = true
  const endpoint = input.translation
    ? 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate'
    : 'wss://api.openai.com/v1/realtime?intent=transcription'
  const socket = new WebSocket(endpoint, {
    headers: { Authorization: 'Bearer ' + input.credential },
    handshakeTimeout: input.settings.timeoutMs,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  })
  let deadline = setTimeout(
    () => fail(new ProviderFailure('TIMEOUT')),
    input.settings.timeoutMs,
  )
  const heartbeat = setInterval(() => {
    if (!pong) {
      fail(new ProviderFailure('UNAVAILABLE'))
      return
    }
    pong = false
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping()
    }
  }, 20_000)
  heartbeat.unref()
  function settle(error?: ProviderFailure) {
    if (closed) {
      return
    }
    closed = true
    clearTimeout(deadline)
    clearTimeout(expires)
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', abort)
    if (socket.readyState === WebSocket.OPEN) {
      socket.close()
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate()
    }
    const reap = setTimeout(() => socket.terminate(), 1000)
    reap.unref()
    socket.once('close', () => clearTimeout(reap))
    if (error) {
      ready.reject(error)
      finished.reject(error)
    } else {
      finished.resolve()
    }
  }
  function fail(error: ProviderFailure) {
    settle(error)
  }
  function abort() {
    fail(new ProviderFailure('TIMEOUT'))
  }
  function send(value: Record<string, unknown>, configuring = false) {
    if (
      closed ||
      socket.readyState !== WebSocket.OPEN ||
      (!configured && !configuring)
    ) {
      throw new ProviderFailure('UNAVAILABLE')
    }
    // 100 ms of 24 kHz PCM16 is 4,800 bytes before base64. Never accumulate
    // seconds of obsolete battle commands behind a congested provider socket.
    if (socket.bufferedAmount > 6_800) {
      fail(new ProviderFailure('UNAVAILABLE'))
      throw new ProviderFailure('UNAVAILABLE')
    }
    socket.send(JSON.stringify(value), (error) => {
      if (error) {
        fail(new ProviderFailure('UNAVAILABLE'))
      }
    })
  }
  socket.on('upgrade', (response) => response.socket.setNoDelay(true))
  socket.on('pong', () => {
    pong = true
  })
  socket.on('unexpected-response', (_request, response) => {
    response.resume()
    fail(openaiFailure(response.statusCode ?? 503))
  })
  socket.on('error', (error) =>
    fail(
      new ProviderFailure(
        /timed out/iu.test(error.message) ? 'TIMEOUT' : 'UNAVAILABLE',
      ),
    ),
  )
  socket.on('close', () => {
    if (!closed) {
      fail(new ProviderFailure('UNAVAILABLE'))
    }
  })
  socket.on('open', () => {
    try {
      send({ type: 'session.update', session: input.configuration }, true)
    } catch {
      fail(new ProviderFailure('UNAVAILABLE'))
    }
  })
  socket.on('message', (data, binary) => {
    if (closed) {
      return
    }
    try {
      if (binary) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      const value: unknown = JSON.parse(data.toString())
      if (
        !value ||
        typeof value !== 'object' ||
        !('type' in value) ||
        typeof value.type !== 'string'
      ) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      const event: OpenAIEvent = { ...value, type: value.type }
      if (event.type === 'error') {
        const error = event.error
        const code =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : ''
        throw openaiFailure(400, code)
      }
      if (
        event.type === 'session.created' &&
        event.session &&
        typeof event.session === 'object' &&
        'expires_at' in event.session &&
        typeof event.session.expires_at === 'number'
      ) {
        const remaining = event.session.expires_at * 1000 - Date.now() - 5000
        expires = setTimeout(
          () => fail(new ProviderFailure('TIMEOUT')),
          Math.max(0, remaining),
        )
        expires.unref()
      }
      if (event.type === 'session.updated') {
        configured = true
        clearTimeout(deadline)
        ready.resolve()
      }
      if (event.type === 'session.closed') {
        if (!ending || !input.translation) {
          throw new ProviderFailure('INVALID_RESPONSE')
        }
        settle()
        return
      }
      input.event(event)
    } catch (error) {
      fail(
        error instanceof ProviderFailure
          ? error
          : new ProviderFailure('INVALID_RESPONSE'),
      )
    }
  })
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) {
    abort()
  }
  return {
    ready: ready.promise,
    finished: finished.promise,
    send,
    complete() {
      settle()
    },
    awaitCompletion() {
      if (closed) {
        return finished.promise
      }
      clearTimeout(deadline)
      deadline = setTimeout(
        () => fail(new ProviderFailure('TIMEOUT')),
        input.settings.timeoutMs,
      )
      return finished.promise
    },
    end() {
      if (!ending && !closed) {
        ending = true
        send({ type: 'session.close' })
        deadline = setTimeout(
          () => fail(new ProviderFailure('TIMEOUT')),
          input.settings.timeoutMs,
        )
      }
      return finished.promise
    },
    close() {
      fail(new ProviderFailure('UNAVAILABLE'))
    },
  }
}
