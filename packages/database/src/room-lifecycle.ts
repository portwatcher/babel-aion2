import { and, eq, inArray, isNull, lte, or, sql, gt } from 'drizzle-orm'
import type { Database } from './client.ts'
import { auditEvent, listenerSession, room } from './schema/rooms.ts'
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
