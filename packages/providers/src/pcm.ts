import { setTimeout } from 'node:timers/promises'
import { ProviderFailure } from './errors.ts'

export interface PcmAudio {
  data: Uint8Array
  sampleRate: 16_000 | 48_000
  durationMs: number
}

export function readPcmWave(bytes: Uint8Array): PcmAudio {
  const wav = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const invalid = () => new ProviderFailure('INVALID_CONFIGURATION')
  if (
    wav.length < 44 ||
    wav.length > 1_000_000 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) + 8 !== wav.length
  ) {
    throw invalid()
  }
  let sampleRate: 16_000 | 48_000 | undefined
  let data: Uint8Array | undefined
  let offset = 12
  while (offset < wav.length) {
    if (offset + 8 > wav.length) {
      throw invalid()
    }
    const type = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    offset += 8
    if (offset + size > wav.length) {
      throw invalid()
    }
    if (type === 'fmt ') {
      if (
        sampleRate ||
        size < 16 ||
        wav.readUInt16LE(offset) !== 1 ||
        wav.readUInt16LE(offset + 2) !== 1 ||
        wav.readUInt16LE(offset + 12) !== 2 ||
        wav.readUInt16LE(offset + 14) !== 16
      ) {
        throw invalid()
      }
      const rate = wav.readUInt32LE(offset + 4)
      if (
        (rate !== 16_000 && rate !== 48_000) ||
        wav.readUInt32LE(offset + 8) !== rate * 2
      ) {
        throw invalid()
      }
      sampleRate = rate
    } else if (type === 'data') {
      if (data || !size || size % 2) {
        throw invalid()
      }
      data = wav.subarray(offset, offset + size)
    }
    offset += size + (size % 2)
  }
  if (offset !== wav.length || !sampleRate || !data) {
    throw invalid()
  }
  const durationMs = (data.byteLength / 2 / sampleRate) * 1000
  if (durationMs < 200 || durationMs > 10_000) {
    throw invalid()
  }
  return { data, sampleRate, durationMs }
}

export async function sendPcmAudio<T>(
  stream: {
    ready: Promise<void>
    finished: Promise<T>
    write: (pcm: Uint8Array, sampleOffset: number) => void
    end: () => Promise<T>
  },
  audio: PcmAudio,
  signal: AbortSignal,
) {
  const cancellation = new AbortController()
  const combined = AbortSignal.any([signal, cancellation.signal])
  try {
    await stream.ready
    const sending = (async () => {
      const started = performance.now()
      const frameBytes = (audio.sampleRate / 50) * 2
      for (let offset = 0; offset < audio.data.byteLength; offset += frameBytes) {
        combined.throwIfAborted()
        const due = (offset / 2 / audio.sampleRate) * 1000
        const wait = due - (performance.now() - started)
        if (wait > 0) {
          await setTimeout(wait, undefined, { signal: combined })
        }
        stream.write(audio.data.subarray(offset, offset + frameBytes), offset / 2)
      }
      await stream.end()
    })()
    const [, completion] = await Promise.all([sending, stream.finished])
    return completion
  } catch (error) {
    if (error instanceof ProviderFailure) {
      throw error
    }
    throw new ProviderFailure(signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE')
  } finally {
    cancellation.abort()
  }
}
