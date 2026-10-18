import { z } from 'zod'
import { languageCodeSchema } from './languages.ts'
import { providerSampleResultSchema } from './provider-samples.ts'

const version = z.number().int().nonnegative().max(2_147_483_646)
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u)
export const languageSaveSchema = z
  .object({
    expectedVersion: version,
    name,
    recognitionConfigurationId: z.uuid(),
    translationConfigurationId: z.uuid(),
    includeTerms: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.recognitionConfigurationId !== value.translationConfigurationId,
  )
export const languageVersionSchema = z
  .object({ expectedVersion: version.positive() })
  .strict()
export const languageStateSchema = languageVersionSchema
  .extend({ enabled: z.boolean() })
  .strict()
export const languageMoveSchema = z
  .object({
    expectedCatalogVersion: version,
    direction: z.enum(['up', 'down']),
  })
  .strict()
export const languageDefaultSchema = z
  .object({
    expectedCatalogVersion: version,
    code: languageCodeSchema.nullable(),
  })
  .strict()
export const languagePageQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    expectedVersion: z.coerce.number().int().min(0).max(2_147_483_646).optional(),
  })
  .strict()
  .refine((value) => value.offset === 0 || value.expectedVersion !== undefined)
const reference = z.object({ id: z.uuid(), version: version.positive() })
export const languageValidationSchema = z.object({
  code: providerSampleResultSchema.shape.code,
  checkedAt: z.iso.datetime({ offset: true }),
  pathVersion: version.positive(),
  recognition: reference,
  translation: reference,
  terminologyVersion: version.nullable(),
  sampleDurationMs: z.number().positive().max(10_000),
  stableUtterances: z.number().int().min(0).max(32),
})
export const managedLanguageSchema = z.object({
  code: languageCodeSchema,
  name,
  version: version.positive(),
  pathVersion: version.positive(),
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
  includeTerms: z.boolean(),
  recognitionConfigurationId: z.uuid().nullable(),
  translationConfigurationId: z.uuid().nullable(),
  validation: languageValidationSchema.nullable(),
  lastAttempt: languageValidationSchema.nullable(),
  validationState: z.enum(['NOT_TESTED', 'CURRENT', 'STALE']),
})
export const languagePageSchema = z.object({
  version,
  items: z.array(managedLanguageSchema).max(50),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  defaultOutputLanguage: languageCodeSchema.nullable(),
  activationAvailable: z.boolean(),
})
export const languageSampleSchema = languageVersionSchema
  .extend({
    audioBase64: z
      .string()
      .min(1)
      .max(1_334_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
export const languageSampleResultSchema = z.object({
  language: managedLanguageSchema,
  sample: providerSampleResultSchema,
})
export type LanguageSave = z.infer<typeof languageSaveSchema>
export type LanguageValidation = z.infer<typeof languageValidationSchema>
export type ManagedLanguage = z.infer<typeof managedLanguageSchema>
export type LanguagePage = z.infer<typeof languagePageSchema>
