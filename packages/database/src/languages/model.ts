import { asc, eq, inArray } from 'drizzle-orm'
import {
  languageCodeSchema,
  languageValidationSchema,
  managedLanguageSchema,
  type ManagedLanguage,
} from '@babel/contracts'
import type { Database } from '../client.ts'
import {
  languageCatalog,
  outputLanguage,
  providerConfiguration,
} from '../schema/rooms.ts'
import { termCatalog } from '../schema/terms.ts'

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type LanguageRecord = typeof outputLanguage.$inferSelect
export class LanguageConfigurationError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'INVALID_LANGUAGE'
      | 'INVALID_PATH'
      | 'PATH_UNVALIDATED'
      | 'DELIVERY_UNAVAILABLE'
      | 'LANGUAGE_ENABLED'
      | 'TERMINOLOGY_CHANGED'
      | 'VERSION_EXHAUSTED',
  ) {
    super(code)
  }
}
export function languageCode(value: string) {
  const result = languageCodeSchema.safeParse(value)
  if (!result.success) {
    throw new LanguageConfigurationError('INVALID_LANGUAGE')
  }
  return result.data
}
export function expected(row: LanguageRecord | undefined, version: number) {
  if (!row) {
    throw new LanguageConfigurationError('NOT_FOUND')
  }
  if (row.version !== version) {
    throw new LanguageConfigurationError('VERSION_CONFLICT')
  }
  return row
}
export async function catalog(tx: Transaction, mode: 'update' | 'share') {
  const [row] = await tx
    .select()
    .from(languageCatalog)
    .where(eq(languageCatalog.id, 'global'))
    .for(mode)
  if (!row) {
    throw new LanguageConfigurationError('NOT_FOUND')
  }
  return row
}
export async function advance(tx: Transaction, version: number) {
  if (version >= 2_147_483_646) {
    throw new LanguageConfigurationError('VERSION_EXHAUSTED')
  }
  await tx
    .update(languageCatalog)
    .set({ version: version + 1 })
    .where(eq(languageCatalog.id, 'global'))
  return version + 1
}
export async function pathReferences(
  tx: Transaction,
  path: Pick<
    LanguageRecord,
    'recognitionConfigurationId' | 'translationConfigurationId'
  >,
) {
  const ids = [path.recognitionConfigurationId, path.translationConfigurationId].filter(
    (id): id is string => Boolean(id),
  )
  if (!ids.length) {
    throw new LanguageConfigurationError('INVALID_PATH')
  }
  const rows = await tx
    .select({
      id: providerConfiguration.id,
      version: providerConfiguration.version,
      type: providerConfiguration.providerType,
    })
    .from(providerConfiguration)
    .where(inArray(providerConfiguration.id, ids))
    .orderBy(asc(providerConfiguration.id))
    .for('share')
  const recognition = rows.find(
    (row) => row.id === path.recognitionConfigurationId && row.type === 'openai',
  )
  const translation = rows.find(
    (row) => row.id === path.translationConfigurationId && row.type === 'openai',
  )
  if (!recognition || !translation) {
    throw new LanguageConfigurationError('INVALID_PATH')
  }
  return {
    recognition: { id: recognition.id, version: recognition.version },
    translation: { id: translation.id, version: translation.version },
  }
}
export async function languageViews(
  tx: Transaction,
  rows: LanguageRecord[],
): Promise<ManagedLanguage[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [
          row.recognitionConfigurationId,
          row.translationConfigurationId,
        ])
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const providers = ids.length
    ? await tx
        .select({
          id: providerConfiguration.id,
          version: providerConfiguration.version,
        })
        .from(providerConfiguration)
        .where(inArray(providerConfiguration.id, ids))
    : []
  const versions = new Map(providers.map((row) => [row.id, row.version]))
  const [terms] = await tx
    .select()
    .from(termCatalog)
    .where(eq(termCatalog.id, 'global'))
  return rows.map((row) => {
    const proof = languageValidationSchema.safeParse(row.validation)
    const validation = proof.success ? proof.data : null
    const attempt = languageValidationSchema.safeParse(row.lastAttempt)
    const current =
      validation?.code === 'PASS' &&
      validation.pathVersion === row.pathVersion &&
      validation.recognition.id === row.recognitionConfigurationId &&
      validation.translation.id === row.translationConfigurationId &&
      validation.recognition.version === versions.get(validation.recognition.id) &&
      validation.translation.version === versions.get(validation.translation.id) &&
      (row.includeTerms
        ? validation.terminologyVersion === terms?.version
        : validation.terminologyVersion === null)
    return managedLanguageSchema.parse({
      ...row,
      validation,
      lastAttempt: attempt.success ? attempt.data : null,
      validationState: validation ? (current ? 'CURRENT' : 'STALE') : 'NOT_TESTED',
    })
  })
}
