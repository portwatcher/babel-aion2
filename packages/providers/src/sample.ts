import {
  sampleSegmentSchema,
  type ProviderSampleResult,
  type SampleSegment,
  type SonioxSettings,
  type DeepLSettings,
  type TerminologySnapshot,
} from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { sendPcmAudio, type PcmAudio } from './pcm.ts'
import { openSharedSubtitleStream } from './subtitle-stream.ts'

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
    const stream = openSharedSubtitleStream({
      recognition: input.recognition,
      sampleRate: input.audio.sampleRate,
      terminology: input.terminology,
      signal: deadline,
    })
    try {
      stream.subscribe(
        {
          outputLanguage: input.outputLanguage,
          settings: input.translation.settings,
          credential: input.translation.credential,
          version: input.translation.version,
        },
        (event) => {
          if (event.type !== 'subtitle') {
            return
          }
          const segment = sampleSegmentSchema.parse(event.value)
          if (!segments.has(segment.utteranceId) && segments.size >= 32) {
            throw new ProviderFailure('INVALID_RESPONSE')
          }
          segments.set(segment.utteranceId, segment)
        },
      )
      await sendPcmAudio(stream, input.audio, deadline)
    } finally {
      stream.close()
    }
    const finalized = [...segments.values()].filter(
      (segment) => segment.isFinal && segment.text.trim(),
    )
    if (!finalized.length) {
      code = 'NO_SPEECH'
    }
    for (const segment of segments.values()) {
      if (segment.failure) {
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
