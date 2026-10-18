import type {
  ProviderSampleResult,
  SampleSegment,
  SonioxSettings,
  DeepLSettings,
  TerminologySnapshot,
} from '@babel/contracts'
import { translateDeepL } from './deepl.ts'
import { ProviderFailure } from './errors.ts'
import { transcribePcm, type PcmAudio } from './pcm.ts'
import { recognitionTerminology, translationTerminology } from './terminology.ts'

export async function previewSubtitleSample(input: {
  recognition: { settings: SonioxSettings; credential: string; version: number }
  translation: { settings: DeepLSettings; credential: string; version: number }
  outputLanguage: string
  audio: PcmAudio
  terminology: TerminologySnapshot | null
}): Promise<ProviderSampleResult> {
  const started = performance.now()
  const deadline = AbortSignal.timeout(30_000)
  const segments = new Map<string, SampleSegment>()
  let code: ProviderSampleResult['code'] = 'PASS'
  try {
    const context = recognitionTerminology(input.terminology?.terms ?? [])
    await transcribePcm(
      input.recognition.settings,
      input.recognition.credential,
      input.audio,
      (transcript) => {
        if (!segments.has(transcript.utteranceId) && segments.size >= 32) {
          throw new ProviderFailure('INVALID_RESPONSE')
        }
        segments.set(transcript.utteranceId, {
          ...transcript,
          translatedText: '',
          translationRevision: 0,
          translationTermCount: 0,
          failure: null,
        })
      },
      deadline,
      context,
    )
    const finalized = [...segments.values()].filter(
      (segment) => segment.isFinal && segment.text.trim(),
    )
    if (!finalized.length) {
      code = 'NO_SPEECH'
    }
    // This is a bounded, isolated comparison of a supplied sample. Translate
    // confirmed utterances once; do not treat provisional hypotheses as evidence.
    for (const segment of finalized) {
      try {
        const terms = translationTerminology(
          input.terminology?.terms ?? [],
          segment.language,
          input.outputLanguage,
        )
        segment.translationTermCount = terms.count
        segment.translatedText = await translateDeepL(
          input.translation.settings,
          input.translation.credential,
          {
            text: segment.text,
            sourceLanguage: segment.language,
            outputLanguage: input.outputLanguage,
            context: terms.context,
          },
          deadline,
        )
        segment.translationRevision = 1
      } catch (error) {
        segment.failure = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
        code = segment.failure
      }
    }
  } catch (error) {
    code = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
  }
  return {
    code,
    outputLanguage: input.outputLanguage,
    recognitionVersion: input.recognition.version,
    translationVersion: input.translation.version,
    audioDurationMs: input.audio.durationMs,
    elapsedMs: Math.round(performance.now() - started),
    segments: [...segments.values()],
    terminology: input.terminology
      ? {
          version: input.terminology.version,
          recognitionTermCount: input.terminology.terms.length,
        }
      : null,
  }
}
