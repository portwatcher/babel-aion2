import { and, asc, eq, ilike, ne } from 'drizzle-orm'
import {
  termPageQuerySchema,
  termRecordSchema,
  termSaveSchema,
  type TermPage,
  type TermSave,
  type TerminologySnapshot,
} from '@babel/contracts'
import type { Database } from './client.ts'
import { gameTerm, termCatalog } from './schema/terms.ts'
import { auditEvent } from './schema/rooms.ts'

export class TermCatalogError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'INVALID_TERM'
      | 'DUPLICATE_TERM'
      | 'VERSION_EXHAUSTED',
  ) {
    super(code)
  }
}
function nextVersion(value: number) {
  if (value >= 2_147_483_646) {
    throw new TermCatalogError('VERSION_EXHAUSTED')
  }
  return value + 1
}
function record(row: typeof gameTerm.$inferSelect) {
  return termRecordSchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() })
}

export function createTermService(db: Database) {
  return {
    async list(query: unknown): Promise<TermPage> {
      const parsed = termPageQuerySchema.safeParse(query)
      if (!parsed.success) {
        throw new TermCatalogError('INVALID_TERM')
      }
      const input = parsed.data
      return db.transaction(async (tx) => {
        // Every mutation takes this row's exclusive lock first. The shared lock
        // makes the catalog version and the following rows one consistent view.
        const [catalog] = await tx
          .select()
          .from(termCatalog)
          .where(eq(termCatalog.id, 'global'))
          .for('share')
        if (!catalog) {
          throw new TermCatalogError('NOT_FOUND')
        }
        if (
          input.expectedVersion !== undefined &&
          catalog.version !== input.expectedVersion
        ) {
          throw new TermCatalogError('VERSION_CONFLICT')
        }
        const pattern = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`
        const rows = await tx
          .select()
          .from(gameTerm)
          .where(input.query ? ilike(gameTerm.sourceTerm, pattern) : undefined)
          .orderBy(
            asc(gameTerm.sourceLanguage),
            asc(gameTerm.sourceTerm),
            asc(gameTerm.id),
          )
          .limit(51)
          .offset(input.offset)
        return {
          version: catalog.version,
          items: rows.slice(0, 50).map(record),
          offset: input.offset,
          nextOffset: rows.length > 50 ? input.offset + 50 : null,
        }
      })
    },
    async snapshot(): Promise<TerminologySnapshot> {
      return db.transaction(async (tx) => {
        const [catalog] = await tx
          .select()
          .from(termCatalog)
          .where(eq(termCatalog.id, 'global'))
          .for('share')
        if (!catalog) {
          throw new TermCatalogError('NOT_FOUND')
        }
        // A provider operation rejects more than 2,000 entries before any
        // network request. Storage remains paginated and has no such row cap.
        const rows = await tx
          .select()
          .from(gameTerm)
          .where(eq(gameTerm.enabled, true))
          .orderBy(asc(gameTerm.id))
          .limit(2_001)
        return { version: catalog.version, terms: rows.map(record) }
      })
    },
    async save(id: string, input: TermSave, actor: string) {
      const parsed = termSaveSchema.safeParse(input)
      if (!parsed.success) {
        throw new TermCatalogError('INVALID_TERM')
      }
      const { expectedVersion, ...data } = parsed.data
      return db.transaction(async (tx) => {
        const [catalog] = await tx
          .select()
          .from(termCatalog)
          .where(eq(termCatalog.id, 'global'))
          .for('update')
        if (!catalog) {
          throw new TermCatalogError('NOT_FOUND')
        }
        const [current] = await tx.select().from(gameTerm).where(eq(gameTerm.id, id))
        if ((current?.version ?? 0) !== expectedVersion) {
          throw new TermCatalogError('VERSION_CONFLICT')
        }
        const peers = await tx
          .select({
            sourceTerm: gameTerm.sourceTerm,
            alternatives: gameTerm.alternatives,
          })
          .from(gameTerm)
          .where(
            and(eq(gameTerm.sourceLanguage, data.sourceLanguage), ne(gameTerm.id, id)),
          )
        const names = new Set(
          [data.sourceTerm, ...data.alternatives].map((value) => value.toLowerCase()),
        )
        if (
          peers.some((peer) =>
            [peer.sourceTerm, ...peer.alternatives].some((name) =>
              names.has(name.toLowerCase()),
            ),
          )
        ) {
          throw new TermCatalogError('DUPLICATE_TERM')
        }
        // Catalog revisions are also entry versions, so deleting and recreating
        // an ID cannot make an old edit's expected version valid again.
        const version = nextVersion(catalog.version)
        const values = { ...data, version, updatedAt: new Date() }
        const rows = current
          ? await tx.update(gameTerm).set(values).where(eq(gameTerm.id, id)).returning()
          : await tx
              .insert(gameTerm)
              .values({ id, ...values })
              .returning()
        const catalogVersion = version
        await tx
          .update(termCatalog)
          .set({ version: catalogVersion })
          .where(eq(termCatalog.id, 'global'))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'term.save',
          resourceId: id,
          metadata: { version, catalogVersion, enabled: data.enabled },
        })
        if (!rows[0]) {
          throw new TermCatalogError('NOT_FOUND')
        }
        return record(rows[0])
      })
    },
    async remove(id: string, version: number, actor: string) {
      return db.transaction(async (tx) => {
        const [catalog] = await tx
          .select()
          .from(termCatalog)
          .where(eq(termCatalog.id, 'global'))
          .for('update')
        const [current] = await tx.select().from(gameTerm).where(eq(gameTerm.id, id))
        if (!catalog || !current) {
          throw new TermCatalogError('NOT_FOUND')
        }
        if (current.version !== version) {
          throw new TermCatalogError('VERSION_CONFLICT')
        }
        const catalogVersion = nextVersion(catalog.version)
        await tx.delete(gameTerm).where(eq(gameTerm.id, id))
        await tx
          .update(termCatalog)
          .set({ version: catalogVersion })
          .where(eq(termCatalog.id, 'global'))
        await tx.insert(auditEvent).values({
          actorSubject: actor,
          action: 'term.remove',
          resourceId: id,
          metadata: { version, catalogVersion },
        })
        return { version: catalogVersion }
      })
    },
  }
}
