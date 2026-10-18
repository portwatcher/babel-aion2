import { z } from 'zod'
import { languageCodeSchema as language } from './languages.ts'

const version = z.number().int().nonnegative().max(2_147_483_646)
function text(maximum: number, minimum = 1) {
  return z
    .string()
    .transform((value) => value.trim().normalize('NFC'))
    .pipe(
      z
        .string()
        .min(minimum)
        .max(maximum)
        .regex(/^[^\p{Cc}\p{Cf}]*$/u),
    )
}
export const termExpressionSchema = z
  .object({
    language,
    text: text(120),
  })
  .strict()
const fields = {
  sourceTerm: text(120),
  sourceLanguage: language,
  alternatives: z
    .array(text(120))
    .max(12)
    .refine(
      (values) =>
        new Set(values.map((value) => value.toLowerCase())).size === values.length,
    ),
  category: text(80),
  expressions: z
    .array(termExpressionSchema)
    .min(1)
    .max(24)
    .refine(
      (values) => new Set(values.map((value) => value.language)).size === values.length,
    ),
  context: text(400, 0),
  enabled: z.boolean(),
}
const distinctSource = (value: { sourceTerm: string; alternatives: string[] }) =>
  !value.alternatives.some(
    (alternative) => alternative.toLowerCase() === value.sourceTerm.toLowerCase(),
  )
export const termSaveSchema = z
  .object({
    ...fields,
    expectedVersion: version,
  })
  .strict()
  .refine(distinctSource)
export const termRecordSchema = z
  .object({
    ...fields,
    id: z.uuid(),
    version: version.positive(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine(distinctSource)
export const termVersionSchema = z
  .object({ expectedVersion: version.positive() })
  .strict()
export const termPageQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    expectedVersion: z.coerce.number().int().min(0).max(2_147_483_646).optional(),
    query: text(120, 0).default(''),
  })
  .strict()
  .refine((value) => value.offset === 0 || value.expectedVersion !== undefined)
export const termPageSchema = z.object({
  version,
  items: z.array(termRecordSchema).max(50),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
})
export type GameTerm = z.infer<typeof termRecordSchema>
export type TermSave = z.infer<typeof termSaveSchema>
export type TermPage = z.infer<typeof termPageSchema>
export interface TerminologySnapshot {
  version: number
  terms: GameTerm[]
}
