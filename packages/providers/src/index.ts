import type { ProviderSettings, ProviderTestCode } from '@babel/contracts'
import { translateDeepL } from './deepl.ts'
import { ProviderFailure } from './errors.ts'
import { probeSoniox } from './soniox.ts'

export { translateDeepL } from './deepl.ts'
export { ProviderFailure } from './errors.ts'
export { readPcmWave } from './pcm.ts'
export { previewSubtitleSample } from './sample.ts'

export async function testProviderConnection(
  settings: ProviderSettings,
  credential: string,
) {
  const started = performance.now()
  let code: ProviderTestCode = 'PASS'
  try {
    if (settings.type === 'soniox') {
      await probeSoniox(settings, credential)
    } else {
      await translateDeepL(settings, credential, {
        text: 'Wait here.',
        sourceLanguage: 'en',
        outputLanguage: 'de',
      })
    }
  } catch (error) {
    code = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
  }
  return {
    code,
    durationMs: Math.round(performance.now() - started),
    checkedAt: new Date().toISOString(),
  }
}
