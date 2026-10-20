import { createHash, timingSafeEqual } from 'node:crypto'
import { mapStrokeInputSchema, type MapStroke } from '@babel/contracts'
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from './client.ts'
import { listenerSession, nickname } from './schema/rooms.ts'
import { mapStroke } from './schema/room-community.ts'

export class MapAccessError extends Error {
  constructor(readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'LIMIT' | 'CONFLICT') {
    super(code)
  }
}

// All requests, including reads, authenticate the room and current generation.
// Mutations share the nickname lock with replacement/removal transactions.
export async function withMapMember<T>(
  db: Database,
  roomId: string,
  sessionId: string,
  credential: string,
  operation: (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    displayName: string,
  ) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, sessionId))
    const actual = createHash('sha256').update(credential).digest()
    const expected = Buffer.from(record?.credentialHash ?? '0'.repeat(64), 'hex')
    if (!record || !timingSafeEqual(actual, expected)) {
      throw new MapAccessError('UNAUTHORIZED')
    }
    const [current] = await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, record.nicknameKey))
      .for('update')
    const [valid] = await tx
      .select()
      .from(listenerSession)
      .where(
        and(
          eq(listenerSession.id, sessionId),
          eq(listenerSession.roomId, roomId),
          inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
          isNull(listenerSession.revokedAt),
        ),
      )
    if (
      !valid ||
      current?.currentSessionId !== sessionId ||
      current.generation !== record.nicknameGeneration
    ) {
      throw new MapAccessError('FORBIDDEN')
    }
    return operation(tx, record.nickname)
  })
}

/**
 * Reads take no lock: one statement authenticates the credential, room and current
 * nickname generation, so a replaced or removed session receives nothing.
 */
export async function readMap(
  db: Database,
  roomId: string,
  sessionId: string,
  credential: string,
): Promise<MapStroke[]> {
  const [record] = await db
    .select({
      credentialHash: listenerSession.credentialHash,
      roomId: listenerSession.roomId,
      state: listenerSession.state,
      revokedAt: listenerSession.revokedAt,
      generation: listenerSession.nicknameGeneration,
      currentSessionId: nickname.currentSessionId,
      currentGeneration: nickname.generation,
    })
    .from(listenerSession)
    .leftJoin(nickname, eq(nickname.key, listenerSession.nicknameKey))
    .where(eq(listenerSession.id, sessionId))
  const actual = createHash('sha256').update(credential).digest()
  const expected = Buffer.from(record?.credentialHash ?? '0'.repeat(64), 'hex')
  if (!record || !timingSafeEqual(actual, expected)) {
    throw new MapAccessError('UNAUTHORIZED')
  }
  if (
    record.roomId !== roomId ||
    !['JOINING', 'ACTIVE'].includes(record.state) ||
    record.revokedAt ||
    record.currentSessionId !== sessionId ||
    record.currentGeneration !== record.generation
  ) {
    throw new MapAccessError('FORBIDDEN')
  }
  const records = await db
    .select()
    .from(mapStroke)
    .where(eq(mapStroke.roomId, roomId))
    .orderBy(asc(mapStroke.createdAt), asc(mapStroke.id))
  return records.map((record) => ({
    ...record,
    createdAt: record.createdAt.toISOString(),
  }))
}

/**
 * A digest that changes whenever a stroke is added or removed. Strokes are
 * immutable, so their count and identities are sufficient. Reveals no content.
 */
export async function mapRevision(db: Database, roomId: string) {
  const [row] = await db
    .select({
      count: count(),
      digest: sql<string>`coalesce(sum(hashtext(${mapStroke.id}::text)::bigint), 0)::text`,
    })
    .from(mapStroke)
    .where(eq(mapStroke.roomId, roomId))
  return `${row?.count ?? 0}:${row?.digest ?? '0'}`
}

export async function drawMap(
  db: Database,
  roomId: string,
  sessionId: string,
  credential: string,
  body: unknown,
) {
  const stroke = mapStrokeInputSchema.parse(body)
  return withMapMember(db, roomId, sessionId, credential, async (tx, displayName) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`babel:map:${roomId}`}, 0))`,
    )
    const [existing] = await tx
      .select()
      .from(mapStroke)
      .where(eq(mapStroke.id, stroke.id))
    if (existing) {
      if (
        existing.roomId !== roomId ||
        existing.sessionId !== sessionId ||
        existing.color !== stroke.color ||
        JSON.stringify(existing.points) !== JSON.stringify(stroke.points)
      ) {
        throw new MapAccessError('CONFLICT')
      }
      return
    }
    const [total] = await tx
      .select({ count: count() })
      .from(mapStroke)
      .where(eq(mapStroke.roomId, roomId))
    const [own] = await tx
      .select({ count: count() })
      .from(mapStroke)
      .where(and(eq(mapStroke.roomId, roomId), eq(mapStroke.sessionId, sessionId)))
    if ((total?.count ?? 0) >= 500 || (own?.count ?? 0) >= 100) {
      throw new MapAccessError('LIMIT')
    }
    await tx
      .insert(mapStroke)
      .values({ ...stroke, roomId, sessionId, nickname: displayName })
  })
}

export async function eraseMap(
  db: Database,
  roomId: string,
  sessionId: string,
  credential: string,
  strokeId: string,
) {
  return withMapMember(db, roomId, sessionId, credential, async (tx) => {
    await tx
      .delete(mapStroke)
      .where(
        and(
          eq(mapStroke.id, strokeId),
          eq(mapStroke.roomId, roomId),
          eq(mapStroke.sessionId, sessionId),
        ),
      )
  })
}
