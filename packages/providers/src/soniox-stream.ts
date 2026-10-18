import {
  providerCredentialSchema,
  sonioxSettingsSchema,
  type SonioxSettings,
  type Transcript,
} from '@babel/contracts'
import { ProviderFailure, sonioxFailure } from './errors.ts'
import { createSonioxTranscript, sonioxResponseSchema } from './soniox-transcript.ts'
import type { RecognitionContext } from './terminology.ts'

export function openSonioxStream(
  settings: SonioxSettings,
  credential: string,
  options: {
    sampleRate: 16_000 | 48_000
    onTranscript: (value: Transcript) => void
    signal?: AbortSignal
    context?: RecognitionContext
  },
) {
  if (
    !sonioxSettingsSchema.safeParse(settings).success ||
    !providerCredentialSchema.safeParse(credential).success
  ) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  const started = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<{
    processedAudioMs: number
    sentAudioMs: number
  }>()
  // Callers can await ready before completion; an early failure must not create
  // an unhandled rejection while they are still sending/setting up audio.
  void started.promise.catch(() => {})
  void completed.promise.catch(() => {})
  let socket: WebSocket
  let settled = false
  let ending = false
  let samples = 0
  let processedAudioMs = 0
  let deadline: ReturnType<typeof setTimeout> | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  let sessionLimit: ReturnType<typeof setTimeout> | undefined
  let retained: Uint8Array<ArrayBuffer>[] = []
  const transcript = createSonioxTranscript(options.onTranscript)
  const abort = () => finish(new ProviderFailure('TIMEOUT'))
  function finish(error?: ProviderFailure) {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(deadline)
    clearTimeout(sessionLimit)
    clearInterval(keepalive)
    options.signal?.removeEventListener('abort', abort)
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        /* Already closed or opening. */
      }
    }
    retained = []
    if (error) {
      started.reject(error)
      completed.reject(error)
    } else {
      completed.resolve({
        processedAudioMs,
        sentAudioMs: (samples / options.sampleRate) * 1000,
      })
    }
  }
  function send(data: string | Uint8Array<ArrayBuffer>) {
    if (settled || socket.readyState !== WebSocket.OPEN) {
      throw new ProviderFailure('UNAVAILABLE')
    }
    try {
      socket.send(data)
    } catch {
      finish(new ProviderFailure('UNAVAILABLE'))
      throw new ProviderFailure('UNAVAILABLE')
    }
  }
  try {
    socket = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket', [
      'soniox-api-key',
      credential,
    ])
  } catch {
    throw new ProviderFailure('INVALID_CREDENTIAL')
  }
  deadline = setTimeout(
    () => finish(new ProviderFailure('TIMEOUT')),
    settings.timeoutMs,
  )
  // End before the documented 300-minute limit. The owner must open a fresh
  // stream/generation; this stream never replays old audio automatically.
  sessionLimit = setTimeout(() => finish(new ProviderFailure('TIMEOUT')), 295 * 60_000)
  options.signal?.addEventListener('abort', abort, { once: true })
  socket.onerror = () => finish(new ProviderFailure('UNAVAILABLE'))
  socket.onclose = () => finish(new ProviderFailure('INVALID_RESPONSE'))
  socket.onopen = () => {
    try {
      send(
        JSON.stringify({
          model: settings.model,
          audio_format: 'pcm_s16le',
          sample_rate: options.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true,
          enable_language_identification: true,
          ...(options.context ? { context: options.context } : {}),
        }),
      )
      clearTimeout(deadline)
      keepalive = setInterval(() => {
        try {
          send(JSON.stringify({ type: 'keepalive' }))
        } catch {
          finish(new ProviderFailure('UNAVAILABLE'))
        }
      }, 10_000)
      started.resolve()
    } catch {
      finish(new ProviderFailure('UNAVAILABLE'))
    }
  }
  socket.onmessage = (event) => {
    try {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 64 * 1024) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      const parsed = sonioxResponseSchema.safeParse(JSON.parse(event.data))
      if (!parsed.success) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      const response = parsed.data
      if (response.error_code) {
        finish(sonioxFailure(response.error_code, response.error_type))
        return
      }
      if (response.total_audio_proc_ms !== undefined) {
        processedAudioMs = response.total_audio_proc_ms
      }
      if (
        response.finished &&
        (!ending || processedAudioMs + 1 < (samples / options.sampleRate) * 1000)
      ) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      transcript.accept(response.tokens, response.finished === true)
      if (response.finished) {
        finish()
      }
    } catch (error) {
      finish(
        error instanceof ProviderFailure
          ? error
          : new ProviderFailure('INVALID_RESPONSE'),
      )
    }
  }
  if (options.signal?.aborted) {
    abort()
  }
  return {
    ready: started.promise,
    finished: completed.promise,
    write(pcm: Uint8Array, sampleOffset: number) {
      if (
        ending ||
        !pcm.byteLength ||
        pcm.byteLength % 2 ||
        pcm.byteLength > (options.sampleRate / 50) * 2 ||
        sampleOffset !== samples
      ) {
        finish(new ProviderFailure('INVALID_CONFIGURATION'))
        throw new ProviderFailure('INVALID_CONFIGURATION')
      }
      if (socket.bufferedAmount + pcm.byteLength > (options.sampleRate * 2) / 2) {
        finish(new ProviderFailure('UNAVAILABLE'))
        throw new ProviderFailure('UNAVAILABLE')
      }
      if (socket.bufferedAmount === 0) {
        retained = []
      }
      const owned = new Uint8Array(pcm)
      retained.push(owned)
      send(owned)
      samples += pcm.byteLength / 2
    },
    end() {
      if (settled || ending) {
        return completed.promise
      }
      ending = true
      clearInterval(keepalive)
      send('')
      deadline = setTimeout(
        () => finish(new ProviderFailure('TIMEOUT')),
        settings.timeoutMs,
      )
      return completed.promise
    },
    close() {
      finish(new ProviderFailure('UNAVAILABLE'))
    },
  }
}
