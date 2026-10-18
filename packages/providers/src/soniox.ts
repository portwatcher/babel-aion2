import {
  providerCredentialSchema,
  sonioxSettingsSchema,
  type SonioxSettings,
} from '@babel/contracts'
import { z } from 'zod'
import { ProviderFailure, sonioxFailure } from './errors.ts'

const responseSchema = z.object({
  error_code: z.number().optional(),
  error_type: z.string().optional(),
  finished: z.boolean().optional(),
  total_audio_proc_ms: z.number().nonnegative().optional(),
})

// This probe sends one second of synthetic silence, never player microphone audio.
// A successful finish proves protocol/model access, not speech or translation quality.
export async function probeSoniox(settings: SonioxSettings, credential: string) {
  const parsed = sonioxSettingsSchema.safeParse(settings)
  if (!parsed.success || !providerCredentialSchema.safeParse(credential).success) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  return new Promise<void>((resolve, reject) => {
    let socket: WebSocket
    let timeout: ReturnType<typeof setTimeout> | undefined
    let pacing: ReturnType<typeof setInterval> | undefined
    let done = false
    let frames = 0
    const audio = new Uint8Array(48_000 * 2) // s16le, 48 kHz, mono, one second.
    function finish(error?: ProviderFailure) {
      if (done) {
        return
      }
      done = true
      clearTimeout(timeout)
      clearInterval(pacing)
      if (socket) {
        socket.onmessage = null
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        try {
          socket.close()
        } catch {
          /* An opening/closed connection needs no further data. */
        }
      }
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    try {
      socket = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket', [
        'soniox-api-key',
        credential,
      ])
    } catch {
      reject(new ProviderFailure('INVALID_CREDENTIAL'))
      return
    }
    timeout = setTimeout(
      () => finish(new ProviderFailure('TIMEOUT')),
      parsed.data.timeoutMs,
    )
    socket.onerror = () => finish(new ProviderFailure('UNAVAILABLE'))
    socket.onclose = () => finish(new ProviderFailure('INVALID_RESPONSE'))
    function send(data: string | Uint8Array<ArrayBuffer>) {
      try {
        socket.send(data)
        return true
      } catch {
        finish(new ProviderFailure('UNAVAILABLE'))
        return false
      }
    }
    socket.onopen = () => {
      if (
        !send(
          JSON.stringify({
            model: parsed.data.model,
            audio_format: 's16le',
            sample_rate: 48_000,
            num_channels: 1,
          }),
        )
      ) {
        return
      }
      pacing = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 48_000) {
          finish(new ProviderFailure('UNAVAILABLE'))
          return
        }
        if (!send(audio.subarray(frames * 1920, (frames + 1) * 1920))) {
          return
        }
        frames += 1
        if (frames === 50) {
          clearInterval(pacing)
          send('') // Empty TEXT ends a stream; empty binary does not.
        }
      }, 20)
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 64 * 1024) {
        finish(new ProviderFailure('INVALID_RESPONSE'))
        return
      }
      try {
        const response = responseSchema.safeParse(JSON.parse(event.data))
        if (!response.success) {
          finish(new ProviderFailure('INVALID_RESPONSE'))
          return
        }
        if (response.data.error_code) {
          finish(sonioxFailure(response.data.error_code, response.data.error_type))
        } else if (response.data.finished) {
          finish(
            frames === 50 && (response.data.total_audio_proc_ms ?? 0) >= 1_000
              ? undefined
              : new ProviderFailure('INVALID_RESPONSE'),
          )
        }
      } catch {
        finish(new ProviderFailure('INVALID_RESPONSE'))
      }
    }
  })
}
