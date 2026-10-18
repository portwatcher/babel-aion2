import { asc, eq, sql } from 'drizzle-orm'
import {
  languagePageQuerySchema,
  languageSaveSchema,
  type LanguageSave,
  type LanguageValidation,
  type ProviderSampleResult,
} from '@babel/contracts'
import type { Database } from '../client.ts'
import { auditEvent, outputLanguage, room } from '../schema/rooms.ts'
import { termCatalog } from '../schema/terms.ts'
import {
  advance,
  catalog,
  expected,
  languageCode,
  languageViews,
  pathReferences,
  LanguageConfigurationError,
} from './model.ts'

export { LanguageConfigurationError } from './model.ts'

export function createLanguageService(db: Database) {
  async function read(code: string) {
    return db.transaction(async (tx) => {
      await catalog(tx, 'share')
      const [row] = await tx
        .select()
        .from(outputLanguage)
        .where(eq(outputLanguage.code, languageCode(code)))
      if (!row) {
        throw new LanguageConfigurationError('NOT_FOUND')
      }
      const [value] = await languageViews(tx, [row])
      if (!value) {
        throw new LanguageConfigurationError('NOT_FOUND')
      }
      return value
    })
  }
  async function prepare(code: string, version: number) {
    return db.transaction(async (tx) => {
      await catalog(tx, 'share')
      const [row] = await tx
        .select()
        .from(outputLanguage)
        .where(eq(outputLanguage.code, languageCode(code)))
      const language = expected(row, version)
      return { language, ...(await pathReferences(tx, language)) }
    })
  }
  return {
    read,
    prepare,
    async list(roomId: string, query: unknown) {
      const parsed = languagePageQuerySchema.safeParse(query)
      if (!parsed.success) {
        throw new LanguageConfigurationError('INVALID_LANGUAGE')
      }
      const input = parsed.data
      return db.transaction(async (tx) => {
        const current = await catalog(tx, 'share')
        if (
          input.expectedVersion !== undefined &&
          current.version !== input.expectedVersion
        ) {
          throw new LanguageConfigurationError('VERSION_CONFLICT')
        }
        const rows = await tx
          .select()
          .from(outputLanguage)
          .orderBy(asc(outputLanguage.order), asc(outputLanguage.code))
          .offset(input.offset)
          .limit(51)
        const [destination] = await tx
          .select({ defaultOutputLanguage: room.defaultOutputLanguage })
          .from(room)
          .where(eq(room.id, roomId))
        return {
          version: current.version,
          items: await languageViews(tx, rows.slice(0, 50)),
          offset: input.offset,
          nextOffset: rows.length > 50 ? input.offset + 50 : null,
          defaultOutputLanguage: destination?.defaultOutputLanguage ?? null,
          activationAvailable: false,
        }
      })
    },
    async save(code: string, input: LanguageSave, actor: string) {
      languageCode(code)
      const parsed = languageSaveSchema.safeParse(input)
      if (!parsed.success) {
        throw new LanguageConfigurationError('INVALID_LANGUAGE')
      }
      const { expectedVersion, ...data } = parsed.data
      await db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        const [current] = await tx
          .select()
          .from(outputLanguage)
          .where(eq(outputLanguage.code, code))
        if ((current?.version ?? 0) !== expectedVersion) {
          throw new LanguageConfigurationError('VERSION_CONFLICT')
        }
        await pathReferences(tx, data)
        const changed =
          !current ||
          current.recognitionConfigurationId !== data.recognitionConfigurationId ||
          current.translationConfigurationId !== data.translationConfigurationId ||
          current.includeTerms !== data.includeTerms
        if (current?.enabled && changed) {
          throw new LanguageConfigurationError('LANGUAGE_ENABLED')
        }
        const version = await advance(tx, revision.version)
        if (current) {
          await tx
            .update(outputLanguage)
            .set({
              ...data,
              version,
              ...(changed
                ? {
                    pathVersion: version,
                    pathValidatedAt: null,
                    validation: null,
                    lastAttempt: null,
                  }
                : {}),
            })
            .where(eq(outputLanguage.code, code))
        } else {
          const [last] = await tx
            .select({ value: sql<number>`coalesce(max(${outputLanguage.order}), -1)` })
            .from(outputLanguage)
          await tx.insert(outputLanguage).values({
            code,
            ...data,
            version,
            pathVersion: version,
            enabled: false,
            order: (last?.value ?? -1) + 1,
          })
        }
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.save',
          resourceId: code,
          metadata: { version, pathChanged: changed },
        })
      })
      return read(code)
    },
    async recordValidation(
      prepared: Awaited<ReturnType<typeof prepare>>,
      sample: ProviderSampleResult,
      actor: string,
    ) {
      const code = prepared.language.code
      const stable = sample.segments.filter(
        (value) =>
          value.isFinal &&
          value.translationIsFinal &&
          value.text.trim() &&
          value.translatedText.trim() &&
          !value.failure,
      ).length
      const resultCode =
        sample.code === 'PASS' &&
        (!stable ||
          stable !== sample.segments.filter((value) => value.text.trim()).length)
          ? 'INVALID_RESPONSE'
          : sample.code
      await db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        const [row] = await tx
          .select()
          .from(outputLanguage)
          .where(eq(outputLanguage.code, code))
        const current = expected(row, prepared.language.version)
        const refs = await pathReferences(tx, current)
        if (
          refs.recognition.version !== prepared.recognition.version ||
          refs.translation.version !== prepared.translation.version ||
          sample.recognitionVersion !== refs.recognition.version ||
          sample.translationVersion !== refs.translation.version ||
          sample.outputLanguage !== code
        ) {
          throw new LanguageConfigurationError('VERSION_CONFLICT')
        }
        if (current.includeTerms) {
          const [terms] = await tx
            .select()
            .from(termCatalog)
            .where(eq(termCatalog.id, 'global'))
            .for('share')
          if (!sample.terminology || terms?.version !== sample.terminology.version) {
            throw new LanguageConfigurationError('TERMINOLOGY_CHANGED')
          }
        } else if (sample.terminology) {
          throw new LanguageConfigurationError('TERMINOLOGY_CHANGED')
        }
        const attempt: LanguageValidation = {
          code: resultCode,
          checkedAt: new Date().toISOString(),
          pathVersion: current.pathVersion,
          ...refs,
          terminologyVersion: sample.terminology?.version ?? null,
          sampleDurationMs: sample.audioDurationMs,
          stableUtterances: stable,
        }
        const version = await advance(tx, revision.version)
        await tx
          .update(outputLanguage)
          .set({
            version,
            lastAttempt: attempt,
            ...(resultCode === 'PASS'
              ? { validation: attempt, pathValidatedAt: new Date(attempt.checkedAt) }
              : {}),
          })
          .where(eq(outputLanguage.code, code))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.validate',
          resourceId: code,
          metadata: {
            version,
            pathVersion: current.pathVersion,
            code: resultCode,
            recognitionVersion: refs.recognition.version,
            translationVersion: refs.translation.version,
            terminologyVersion: attempt.terminologyVersion,
          },
        })
      })
      return { language: await read(code), sample: { ...sample, code: resultCode } }
    },
    async state(code: string, version: number, enabled: boolean, actor: string) {
      await db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        const [row] = await tx
          .select()
          .from(outputLanguage)
          .where(eq(outputLanguage.code, languageCode(code)))
        const current = expected(row, version)
        if (enabled) {
          const [view] = await languageViews(tx, [current])
          if (view?.validationState !== 'CURRENT') {
            throw new LanguageConfigurationError('PATH_UNVALIDATED')
          }
          // The shared processor exists, but no worker-to-player delivery path
          // has been proved. Do not turn a sample success into production access.
          throw new LanguageConfigurationError('DELIVERY_UNAVAILABLE')
        }
        const next = await advance(tx, revision.version)
        await tx
          .update(outputLanguage)
          .set({ enabled: false, version: next })
          .where(eq(outputLanguage.code, code))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.disable',
          resourceId: code,
          metadata: { version: next },
        })
      })
      return read(code)
    },
    async move(
      code: string,
      expectedVersion: number,
      direction: 'up' | 'down',
      actor: string,
    ) {
      return db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        if (revision.version !== expectedVersion) {
          throw new LanguageConfigurationError('VERSION_CONFLICT')
        }
        const rows = await tx
          .select()
          .from(outputLanguage)
          .orderBy(asc(outputLanguage.order), asc(outputLanguage.code))
        const index = rows.findIndex((row) => row.code === languageCode(code))
        const current = rows[index]
        const neighbor = rows[index + (direction === 'up' ? -1 : 1)]
        if (!current) {
          throw new LanguageConfigurationError('NOT_FOUND')
        }
        if (!neighbor) {
          return { version: revision.version }
        }
        const version = await advance(tx, revision.version)
        await tx
          .update(outputLanguage)
          .set({ order: neighbor.order, version })
          .where(eq(outputLanguage.code, code))
        await tx
          .update(outputLanguage)
          .set({ order: current.order, version })
          .where(eq(outputLanguage.code, neighbor.code))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.move',
          resourceId: code,
          metadata: { version, direction },
        })
        return { version }
      })
    },
    async default(
      roomId: string,
      code: string | null,
      expectedVersion: number,
      actor: string,
    ) {
      return db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        if (revision.version !== expectedVersion) {
          throw new LanguageConfigurationError('VERSION_CONFLICT')
        }
        if (code !== null) {
          const [row] = await tx
            .select({ code: outputLanguage.code })
            .from(outputLanguage)
            .where(eq(outputLanguage.code, languageCode(code)))
          if (!row) {
            throw new LanguageConfigurationError('NOT_FOUND')
          }
        }
        const [updated] = await tx
          .update(room)
          .set({ defaultOutputLanguage: code })
          .where(eq(room.id, roomId))
          .returning({ id: room.id })
        if (!updated) {
          throw new LanguageConfigurationError('NOT_FOUND')
        }
        const version = await advance(tx, revision.version)
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.default',
          resourceId: roomId,
          metadata: { version, code },
        })
        return { version }
      })
    },
    async remove(code: string, version: number, actor: string) {
      return db.transaction(async (tx) => {
        const revision = await catalog(tx, 'update')
        const [row] = await tx
          .select()
          .from(outputLanguage)
          .where(eq(outputLanguage.code, languageCode(code)))
        const current = expected(row, version)
        if (current.enabled) {
          throw new LanguageConfigurationError('LANGUAGE_ENABLED')
        }
        await tx
          .update(room)
          .set({ defaultOutputLanguage: null })
          .where(eq(room.defaultOutputLanguage, code))
        await tx.delete(outputLanguage).where(eq(outputLanguage.code, code))
        const next = await advance(tx, revision.version)
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'language.remove',
          resourceId: code,
          metadata: { version: next },
        })
        return { version: next }
      })
    },
  }
}
