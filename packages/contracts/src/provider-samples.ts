import { z } from 'zod'
import { providerTestCodeSchema } from './providers.ts'
import { languageCodeSchema as language } from './languages.ts'

const reference = z
  .object({ id: z.uuid(), version: z.number().int().positive() })
  .strict()
export const providerSampleRequestSchema = z
  .object({
    recognition: reference,
    translation: reference,
    outputLanguage: language,
    includeTerms: z.boolean().default(true),
    audioBase64: z
      .string()
      .min(1)
      .max(1_334_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
  .refine((value) => value.recognition.id !== value.translation.id)

export const transcriptSchema = z.object({
  utteranceId: z.uuid(),
  revision: z.number().int().positive(),
  text: z.string().max(4096),
  language: z.string().min(2).max(35),
  isFinal: z.boolean(),
  audioStartMs: z.number().nonnegative().nullable(),
  audioEndMs: z.number().nonnegative().nullable(),
})
export const sampleSegmentSchema = transcriptSchema.extend({
  translatedText: z.string().max(16_384),
  translationRevision: z.number().int().nonnegative(),
  translationTermCount: z.number().int().nonnegative(),
  failure: providerTestCodeSchema.exclude(['PASS']).nullable(),
})
export const providerSampleResultSchema = z.object({
  code: z.union([providerTestCodeSchema, z.literal('NO_SPEECH')]),
  outputLanguage: language,
  recognitionVersion: z.number().int().positive(),
  translationVersion: z.number().int().positive(),
  audioDurationMs: z.number().positive().max(10_000),
  elapsedMs: z.number().nonnegative(),
  segments: z.array(sampleSegmentSchema).max(32),
  terminology: z
    .object({
      version: z.number().int().nonnegative(),
      recognitionTermCount: z.number().int().nonnegative(),
    })
    .nullable(),
})
export type ProviderSampleRequest = z.infer<typeof providerSampleRequestSchema>
export type ProviderSampleResult = z.infer<typeof providerSampleResultSchema>
export type SampleSegment = z.infer<typeof sampleSegmentSchema>
export type Transcript = z.infer<typeof transcriptSchema>
