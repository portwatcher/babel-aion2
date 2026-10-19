import { nicknameKey } from '@babel/contracts'
import { and, asc, eq, inArray, isNull, lte, or, sql, gt } from 'drizzle-orm'
import type { Database } from './client.ts'
import { ListenerError, verifyCredential } from './listeners/model.ts'
import { auditEvent, listenerSession, nickname, room } from './schema/rooms.ts'
import { communityRoom } from './schema/room-community.ts'

/** Durable empty-room expiry, shared by every web replica's reconciler. */
export async function disbandEmptyCommunityRooms(db: Database) {
  const cutoff = sql`now() - interval '5 minutes'`
  const candidates = await db
    .select({ id: room.id })
    .from(room)
    .innerJoin(communityRoom, eq(communityRoom.roomId, room.id))
    .where(and(isNull(room.disbandedAt), lte(communityRoom.createdAt, cutoff)))
  for (const { id } of candidates) {
    await db.transaction(async (tx) => {
      // Entry holds a shared lock through session creation. Recheck membership
      // AFTER this exclusive lock: either entry wins or future entry sees the
      // tombstone. SKIP LOCKED lets another replica finish a contested room.
      const [stored] = await tx
        .select()
        .from(room)
        .where(and(eq(room.id, id), isNull(room.disbandedAt)))
        .for('update', { skipLocked: true })
      if (!stored) {
        return
      }
      const [remaining] = await tx
        .select({ id: listenerSession.id })
        .from(listenerSession)
        .where(
          and(
            eq(listenerSession.roomId, id),
            or(
              inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
              isNull(listenerSession.deliveryStoppedAt),
              gt(listenerSession.joinedAt, cutoff),
              gt(listenerSession.revokedAt, cutoff),
              gt(listenerSession.deliveryStoppedAt, cutoff),
            ),
          ),
        )
        .limit(1)
      if (remaining) {
        return
      }
      await tx
        .update(room)
        .set({
          stopped: true,
          disbandedAt: sql`now()`,
          updatedAt: sql`now()`,
          configurationVersion: stored.configurationVersion + 1,
        })
        .where(eq(room.id, id))
      // Keep the guild's source generation stable: stopping this destination
      // must not restart the receiver used by occupied sibling rooms.
      await tx.insert(auditEvent).values({
        actorSubject: 'system:room-lifecycle',
        action: 'room.disband',
        resourceId: id,
        metadata: { reason: 'EMPTY_TIMEOUT', timeoutSeconds: 300 },
      })
    })
  }
}

/**
 * The host character's current session disbands its community room at once.
 * Every remaining session ends with ROOM_CLOSED; the caller still has to stop
 * their delivery, exactly as for any other removal.
 */
export async function closeRoomAsHost(
  db: Database,
  sessionId: string,
  credential: string,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, sessionId))
    const host = verifyCredential(record, credential)
    // Same lock order as entry: room first, then nickname keys.
    const [stored] = await tx
      .select({ room, community: communityRoom })
      .from(room)
      .innerJoin(communityRoom, eq(communityRoom.roomId, room.id))
      .where(and(eq(room.id, host.roomId), isNull(room.disbandedAt)))
      .for('update', { of: room })
    if (!stored) {
      throw new ListenerError('ROOM_NOT_FOUND')
    }
    const members = await tx
      .select()
      .from(listenerSession)
      .where(
        and(
          eq(listenerSession.roomId, host.roomId),
          inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
          isNull(listenerSession.revokedAt),
        ),
      )
      .orderBy(asc(listenerSession.nicknameKey))
    const keys = members.map((member) => member.nicknameKey)
    const current = keys.length
      ? await tx
          .select()
          .from(nickname)
          .where(inArray(nickname.key, keys))
          .orderBy(asc(nickname.key))
          .for('update')
      : []
    const hostKey = current.find((item) => item.key === host.nicknameKey)
    if (
      !members.some((member) => member.id === host.id) ||
      hostKey?.currentSessionId !== host.id ||
      hostKey.generation !== host.nicknameGeneration
    ) {
      throw new ListenerError('SESSION_ENDED')
    }
    if (
      !stored.room.hostCharacterId ||
      nicknameKey(host.nickname) !== nicknameKey(stored.room.hostCharacterId)
    ) {
      throw new ListenerError('NOT_ROOM_HOST')
    }
    await tx
      .update(room)
      .set({
        stopped: true,
        disbandedAt: sql`now()`,
        updatedAt: sql`now()`,
        configurationVersion: stored.room.configurationVersion + 1,
      })
      .where(eq(room.id, host.roomId))
    const removed = await tx
      .update(listenerSession)
      .set({ state: 'REMOVED', terminalReason: 'ROOM_CLOSED', revokedAt: new Date() })
      .where(
        inArray(
          listenerSession.id,
          members.map((member) => member.id),
        ),
      )
      .returning()
    await tx.insert(auditEvent).values({
      actorSubject: 'player:room-host',
      action: 'room.disband',
      resourceId: host.roomId,
      metadata: { reason: 'HOST_CLOSED', members: removed.length },
    })
    return { host: removed.find((item) => item.id === host.id)!, removed }
  })
}
