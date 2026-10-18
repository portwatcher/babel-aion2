import type { ListenerReference } from '@babel/contracts'
import { and, eq, isNull } from 'drizzle-orm'
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

export async function renewPlayerConnection(
  db: Database,
  connectionId: string,
  ownerId: string,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ listener: listenerSession })
      .from(playerConnection)
      .innerJoin(listenerSession, eq(listenerSession.id, playerConnection.sessionId))
      .where(
        and(
          eq(playerConnection.id, connectionId),
          eq(playerConnection.ownerId, ownerId),
          isNull(playerConnection.closedAt),
        ),
      )
    if (!record) {
      return
    }
    await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, record.listener.nicknameKey))
      .for('update')
    const [current] = await tx
      .select()
      .from(nickname)
      .where(
        and(
          eq(nickname.key, record.listener.nicknameKey),
          eq(nickname.currentSessionId, record.listener.id),
          eq(nickname.generation, record.listener.nicknameGeneration),
        ),
      )
    if (current) {
      await tx
        .update(listenerSession)
        .set({ lastSeenAt: new Date() })
        .where(
          and(
            eq(listenerSession.id, record.listener.id),
            isNull(listenerSession.revokedAt),
          ),
        )
    }
  })
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
