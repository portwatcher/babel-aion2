import type { ListenerReference } from '@babel/contracts'
import { and, eq, inArray, isNull, max, ne } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { mediaConnection } from '../schema/media-connections.ts'
import { listenerSession, nickname } from '../schema/rooms.ts'
import { ListenerError, snapshot, verifyCredential } from './model.ts'
import { lockRuntimeOwner } from '../runtime-owners.ts'

export async function authorizeMediaSession(
  db: Pick<Database, 'select'>,
  reference: ListenerReference,
  credential: string,
) {
  const [record] = await db
    .select()
    .from(listenerSession)
    .where(eq(listenerSession.id, reference.sessionId))
  const session = verifyCredential(record, credential)
  const [current] = await db
    .select()
    .from(nickname)
    .where(eq(nickname.key, session.nicknameKey))
  if (
    session.nicknameGeneration !== reference.nicknameGeneration ||
    session.state !== 'ACTIVE' ||
    session.revokedAt ||
    current?.currentSessionId !== session.id ||
    current.generation !== reference.nicknameGeneration
  ) {
    throw new ListenerError('SESSION_ENDED')
  }
  return snapshot(session)
}

export async function openMediaConnection(
  db: Database,
  id: string,
  ownerId: string,
  attempt: number,
  reference: ListenerReference,
  credential: string,
) {
  return db.transaction(async (tx) => {
    await lockRuntimeOwner(tx, ownerId)
    const [original] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, reference.sessionId))
    const authenticated = verifyCredential(original, credential)
    await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, authenticated.nicknameKey))
      .for('update')
    // Re-read after the same global nickname lock used by replacement. A
    // pre-revocation read cannot register a new connection after its shutdown check.
    await authorizeMediaSession(tx, reference, credential)
    const [existing] = await tx
      .select()
      .from(mediaConnection)
      .where(eq(mediaConnection.id, id))
    if (existing) {
      if (
        existing.ownerId !== ownerId ||
        existing.sessionId !== reference.sessionId ||
        existing.attempt !== attempt ||
        existing.nicknameGeneration !== reference.nicknameGeneration ||
        existing.closeRequestedAt ||
        existing.closedAt
      ) {
        throw new ListenerError('ENTRY_CONFLICT')
      }
      return existing
    }
    const [previous] = await tx
      .select({ attempt: max(mediaConnection.attempt) })
      .from(mediaConnection)
      .where(eq(mediaConnection.sessionId, reference.sessionId))
    if (
      previous?.attempt !== null &&
      previous?.attempt !== undefined &&
      previous.attempt >= attempt
    ) {
      throw new ListenerError('ENTRY_CONFLICT')
    }
    // An explicit new media negotiation supersedes prior ones for this same
    // listener, while preserving its nickname generation and language choice.
    await tx
      .update(mediaConnection)
      .set({ closeRequestedAt: new Date() })
      .where(
        and(
          eq(mediaConnection.sessionId, reference.sessionId),
          eq(mediaConnection.nicknameGeneration, reference.nicknameGeneration),
          isNull(mediaConnection.closeRequestedAt),
          isNull(mediaConnection.closedAt),
        ),
      )
    const [created] = await tx
      .insert(mediaConnection)
      .values({
        id,
        ownerId,
        attempt,
        sessionId: reference.sessionId,
        nicknameGeneration: reference.nicknameGeneration,
      })
      .returning()
    if (!created) {
      throw new Error('Media connection registration failed')
    }
    return created
  })
}

export async function mediaConnectionAuthorized(
  db: Database,
  id: string,
  ownerId: string,
) {
  return (await authorizedMediaConnections(db, [id], ownerId)).has(id)
}

/** The currently authorized subset, checked for every live peer in one query. */
export async function authorizedMediaConnections(
  db: Database,
  ids: string[],
  ownerId: string,
) {
  if (!ids.length) {
    return new Set<string>()
  }
  const records = await db
    .select({ id: mediaConnection.id })
    .from(mediaConnection)
    .innerJoin(listenerSession, eq(listenerSession.id, mediaConnection.sessionId))
    .innerJoin(nickname, eq(nickname.key, listenerSession.nicknameKey))
    .where(
      and(
        inArray(mediaConnection.id, ids),
        eq(mediaConnection.ownerId, ownerId),
        eq(listenerSession.nicknameGeneration, mediaConnection.nicknameGeneration),
        eq(nickname.currentSessionId, listenerSession.id),
        eq(nickname.generation, listenerSession.nicknameGeneration),
        eq(listenerSession.state, 'ACTIVE'),
        isNull(listenerSession.revokedAt),
        isNull(mediaConnection.closeRequestedAt),
        isNull(mediaConnection.closedAt),
      ),
    )
  return new Set(records.map((record) => record.id))
}

export async function earlierMediaConnectionsStopped(
  db: Database,
  id: string,
  reference: ListenerReference,
) {
  const [open] = await db
    .select({ id: mediaConnection.id })
    .from(mediaConnection)
    .where(
      and(
        eq(mediaConnection.sessionId, reference.sessionId),
        eq(mediaConnection.nicknameGeneration, reference.nicknameGeneration),
        ne(mediaConnection.id, id),
        isNull(mediaConnection.closedAt),
      ),
    )
    .limit(1)
  return !open
}

export async function closeMediaConnection(db: Database, id: string, ownerId: string) {
  // Only the owning transport calls this after creation/answer work has settled
  // and its actual RTCPeerConnection close has completed. Never expire by age.
  await db
    .update(mediaConnection)
    .set({ closedAt: new Date() })
    .where(
      and(
        eq(mediaConnection.id, id),
        eq(mediaConnection.ownerId, ownerId),
        isNull(mediaConnection.closedAt),
      ),
    )
}

export async function mediaConnectionsStopped(
  db: Database,
  reference: ListenerReference,
) {
  const [session] = await db
    .select({ revokedAt: listenerSession.revokedAt })
    .from(listenerSession)
    .where(
      and(
        eq(listenerSession.id, reference.sessionId),
        eq(listenerSession.nicknameGeneration, reference.nicknameGeneration),
      ),
    )
  if (!session?.revokedAt) {
    return false
  }
  const [open] = await db
    .select({ id: mediaConnection.id })
    .from(mediaConnection)
    .where(
      and(
        eq(mediaConnection.sessionId, reference.sessionId),
        eq(mediaConnection.nicknameGeneration, reference.nicknameGeneration),
        isNull(mediaConnection.closedAt),
      ),
    )
    .limit(1)
  return !open
}
