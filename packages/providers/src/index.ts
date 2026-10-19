import type { OpenAISettings, ProviderTestCode } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { openRecognition } from './openai-recognition.ts'
import { openTranslation } from './openai-translation.ts'

export { ProviderFailure } from './errors.ts'
export { readPcmWave } from './pcm.ts'
export { previewSubtitleSample } from './sample.ts'
export {
  openSharedSubtitleStream,
  type SubtitleStreamEvent,
} from './subtitle-stream.ts'
export type { TranslationPath, SubtitleUpdate } from './subtitle-work.ts'

export async function testProviderConnection(
  settings: OpenAISettings,
  credential: string,
) {
  const started = performance.now()
  let code: ProviderTestCode = 'PASS'
  const recognition = openRecognition({ settings, credential, onTranscript() {} })
  const translation = openTranslation({
    settings,
    credential,
    outputLanguage: 'ja',
    delta() {},
  })
  try {
    // Verify access to both actual models, not merely that an API key exists.
    await Promise.all([recognition.ready, translation.ready])
  } catch (error) {
    code = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
  } finally {
    recognition.close()
    translation.close()
  }
  return {
    code,
    durationMs: Math.round(performance.now() - started),
    checkedAt: new Date().toISOString(),
  }
}
