import type { SonioxSettings } from '@babel/contracts'
import { transcribePcm } from './pcm.ts'

// The connection probe uses the same stream/parser as actual sample recognition.
// Synthetic silence proves protocol access, not recognition or language quality.
export async function probeSoniox(settings: SonioxSettings, credential: string) {
  return transcribePcm(
    settings,
    credential,
    {
      data: new Uint8Array(48_000 * 2),
      sampleRate: 48_000,
      durationMs: 1_000,
    },
    () => {},
    AbortSignal.timeout(settings.timeoutMs),
  )
}
