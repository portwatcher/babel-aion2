import { z } from 'zod'

const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u)
const timeoutMs = z.number().int().min(1_000).max(30_000)
const version = z.number().int().nonnegative().max(2_147_483_646)
export const providerCredentialSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/)
export const sonioxSettingsSchema = z
  .object({
    type: z.literal('soniox'),
    model: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
    timeoutMs,
  })
  .strict()
export const deeplSettingsSchema = z
  .object({
    type: z.literal('deepl'),
    endpoint: z.enum(['https://api.deepl.com', 'https://api-free.deepl.com']),
    model: z.enum([
      'quality_optimized',
      'latency_optimized',
      'prefer_quality_optimized',
    ]),
    timeoutMs,
  })
  .strict()
export const providerSettingsSchema = z.discriminatedUnion('type', [
  sonioxSettingsSchema,
  deeplSettingsSchema,
])
export const providerSaveSchema = z
  .object({
    expectedVersion: version,
    name,
    settings: providerSettingsSchema,
    credential: providerCredentialSchema.optional(),
  })
  .strict()
export const providerVersionSchema = z
  .object({ expectedVersion: version.positive() })
  .strict()
export const providerRestoreSchema = providerVersionSchema
  .extend({
    restoreVersion: version.positive(),
  })
  .strict()
export const providerTestCodeSchema = z.enum([
  'PASS',
  'INVALID_CREDENTIAL',
  'MODEL_UNAVAILABLE',
  'QUOTA_EXHAUSTED',
  'RATE_LIMITED',
  'PERMISSION_DENIED',
  'INVALID_CONFIGURATION',
  'TIMEOUT',
  'UNAVAILABLE',
  'INVALID_RESPONSE',
  'CONTEXT_TOO_LARGE',
])
export const providerTestResultSchema = z.object({
  code: providerTestCodeSchema,
  checkedAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().nonnegative(),
  configurationVersion: version.positive(),
})
export const providerSummarySchema = z.object({
  id: z.uuid(),
  name,
  settings: providerSettingsSchema,
  version: version.positive(),
  credentialConfigured: z.boolean(),
  enabled: z.boolean(),
  lastTest: providerTestResultSchema.nullable(),
  history: z.array(
    z.object({
      version: version.positive(),
      name,
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
})
export const providerListSchema = z.object({
  configurations: z.array(providerSummarySchema),
  credentialProtectionReady: z.boolean(),
})
export type ProviderSettings = z.infer<typeof providerSettingsSchema>
export type SonioxSettings = z.infer<typeof sonioxSettingsSchema>
export type DeepLSettings = z.infer<typeof deeplSettingsSchema>
export type ProviderSave = z.infer<typeof providerSaveSchema>
export type ProviderSummary = z.infer<typeof providerSummarySchema>
export type ProviderTestCode = z.infer<typeof providerTestCodeSchema>
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>
