import type { ListenerReference, ListenerSnapshot } from '@babel/contracts'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { playerConnection } from '../schema/player-connections.ts'
import { listenerSession, nickname } from '../schema/rooms.ts'
import { ListenerError, snapshot, verifyCredential } from './model.ts'
import { lockRuntimeOwner } from '../runtime-owners.ts'

export async function openPlayerConnection(
  db: Database,
  connectionId: string,
  ownerId: string,
  sessionId: string,
  credential: string,
) {
  return db.transaction(async (tx) => {
    await lockRuntimeOwner(tx, ownerId)
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, sessionId))
    const authenticated = verifyCredential(record, credential)
    const [current] = await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, authenticated.nicknameKey))
      .for('update')
    const [fresh] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, sessionId))
    if (!fresh) {
      throw new ListenerError('INVALID_CREDENTIAL')
    }
    if (
      current?.currentSessionId === sessionId &&
      current.generation === fresh.nicknameGeneration &&
      ['JOINING', 'ACTIVE'].includes(fresh.state) &&
      !fresh.revokedAt
    ) {
      // Registration shares the nickname lock with replacement. An old handshake
      // cannot register after revocation has already observed zero connections.
      await tx.insert(playerConnection).values({
        id: connectionId,
        ownerId,
        sessionId,
        nicknameGeneration: fresh.nicknameGeneration,
      })
      await tx
        .update(listenerSession)
        .set({ lastSeenAt: new Date() })
        .where(eq(listenerSession.id, sessionId))
    }
    return snapshot(fresh)
  })
}

export async function readPlayerConnection(db: Database, reference: ListenerReference) {
  const [record] = await db
    .select()
    .from(listenerSession)
    .where(
      and(
        eq(listenerSession.id, reference.sessionId),
        eq(listenerSession.nicknameGeneration, reference.nicknameGeneration),
      ),
    )
  return record ? snapshot(record) : null
}

/** One round trip for every socket a sweep verifies; keyed by session ID. */
export async function readPlayerConnections(
  db: Database,
  references: ListenerReference[],
) {
  const sessions = new Map<string, ListenerSnapshot>()
  if (!references.length) {
    return sessions
  }
  const records = await db
    .select()
    .from(listenerSession)
    .where(
      inArray(
        listenerSession.id,
        references.map((reference) => reference.sessionId),
      ),
    )
  for (const record of records) {
    sessions.set(record.id, snapshot(record))
  }
  return sessions
}

/**
 * Batches heartbeat last_seen_at updates for verified, currently active
 * connections owned by this web replica in one atomic SQL statement.
 */
export async function renewPlayerConnections(
  db: Database,
  connectionIds: string[],
  ownerId: string,
) {
  const unique = [...new Set(connectionIds)]
  if (!unique.length) {
    return
  }
  const now = new Date()
  await db.execute(sql`
    update listener_session as ls
    set last_seen_at = ${now}
    from player_connection as pc
    inner join nickname as n
      on n.current_session_id = pc.session_id
     and n.generation = pc.nickname_generation
    where ls.id = pc.session_id
      and ls.nickname_key = n.key
      and ls.nickname_generation = pc.nickname_generation
      and ls.revoked_at is null
      and pc.owner_id = ${ownerId}::uuid
      and pc.closed_at is null
      and pc.id in (${sql.join(
        unique.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  `)
}

export async function renewPlayerConnection(
  db: Database,
  connectionId: string,
  ownerId: string,
) {
  await renewPlayerConnections(db, [connectionId], ownerId)
}

export async function closePlayerConnection(
  db: Database,
  connectionId: string,
  ownerId: string,
) {
  await db
    .update(playerConnection)
    .set({ closedAt: new Date() })
    .where(
      and(
        eq(playerConnection.id, connectionId),
        eq(playerConnection.ownerId, ownerId),
        isNull(playerConnection.closedAt),
      ),
    )
}

export async function subtitleConnectionsStopped(
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
    .select({ id: playerConnection.id })
    .from(playerConnection)
    .where(
      and(
        eq(playerConnection.sessionId, reference.sessionId),
        eq(playerConnection.nicknameGeneration, reference.nicknameGeneration),
        isNull(playerConnection.closedAt),
      ),
    )
    .limit(1)
  // No TTL shortcut: orphaned records remain unconfirmed until their owning
  // transport has actually stopped. A database/network fault is not that proof.
  return !open
}
