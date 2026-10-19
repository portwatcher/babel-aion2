import { ProviderFailure } from './errors.ts'

/** Stateful conversion once per speaker; every target reuses the same bytes. */
export function createPcm24k(sampleRate: 16_000 | 48_000) {
  let previous = 0
  return (pcm: Uint8Array) => {
    if (!pcm.byteLength || pcm.byteLength % 2) {
      throw new ProviderFailure('INVALID_CONFIGURATION')
    }
    const source = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const count = pcm.byteLength / 2
    const output = Buffer.alloc(Math.ceil((count * 24_000) / sampleRate) * 2)
    let energy = 0
    for (let i = 0; i < count; i += 1) {
      const value = source.readInt16LE(i * 2)
      energy += value * value
    }
    if (sampleRate === 48_000) {
      // A short symmetric low-pass decimator removes high-frequency energy
      // before downsampling, without retaining an extra audio frame.
      for (let i = 0; i < count; i += 2) {
        const a = source.readInt16LE(i * 2)
        const b = i + 1 < count ? source.readInt16LE(i * 2 + 2) : a
        output.writeInt16LE(Math.round((previous + 2 * a + b) / 4), i)
        previous = b
      }
    } else {
      for (let i = 0, j = 0; i < count; i += 2, j += 3) {
        const a = source.readInt16LE(i * 2)
        const b = i + 1 < count ? source.readInt16LE(i * 2 + 2) : a
        output.writeInt16LE(a, j * 2)
        output.writeInt16LE(Math.round((a + 2 * b) / 3), (j + 1) * 2)
        const next = i + 2 < count ? source.readInt16LE(i * 2 + 4) : b
        if (i + 1 < count) {
          output.writeInt16LE(Math.round((2 * b + next) / 3), (j + 2) * 2)
        }
      }
    }
    return {
      audio: output.toString('base64'),
      durationMs: (count / sampleRate) * 1000,
      speech: energy / count >= 250 * 250,
    }
  }
}
