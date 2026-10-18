import type {
  ListenerReference,
  ManagementListener,
  PublicListener,
} from '@babel/contracts'
import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { listenerSession, nickname } from '../schema/rooms.ts'

export async function listManagementListeners(
  db: Database,
  roomId: string,
): Promise<ManagementListener[]> {
  const records = await db
    .select({
      sessionId: listenerSession.id,
      nickname: listenerSession.nickname,
      nicknameGeneration: listenerSession.nicknameGeneration,
      joinedAt: listenerSession.joinedAt,
      state: listenerSession.state,
      revokedAt: listenerSession.revokedAt,
    })
    .from(listenerSession)
    .where(
      and(
        eq(listenerSession.roomId, roomId),
        or(
          inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
          and(
            isNotNull(listenerSession.revokedAt),
            isNull(listenerSession.deliveryStoppedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(listenerSession.joinedAt), asc(listenerSession.id))
  return records.map((record) => ({
    sessionId: record.sessionId,
    nickname: record.nickname,
    nicknameGeneration: record.nicknameGeneration,
    joinedAt: record.joinedAt.toISOString(),
    state: record.revokedAt
      ? 'DISCONNECTING'
      : record.state === 'ACTIVE'
        ? 'ACTIVE'
        : 'JOINING',
  }))
}

export async function listPublicListeners(
  db: Database,
  roomId: string,
): Promise<PublicListener[]> {
  return (await listManagementListeners(db, roomId)).map(
    ({ sessionId, nickname, joinedAt, state }) => ({
      sessionId,
      nickname,
      joinedAt,
      state,
    }),
  )
}

export async function isDeliveryAuthorized(db: Database, reference: ListenerReference) {
  const [record] = await db
    .select({ id: listenerSession.id })
    .from(listenerSession)
    .innerJoin(nickname, eq(nickname.key, listenerSession.nicknameKey))
    .where(
      and(
        eq(listenerSession.id, reference.sessionId),
        eq(listenerSession.nicknameGeneration, reference.nicknameGeneration),
        eq(nickname.currentSessionId, reference.sessionId),
        eq(nickname.generation, reference.nicknameGeneration),
        eq(listenerSession.state, 'ACTIVE'),
        isNull(listenerSession.revokedAt),
      ),
    )
  return Boolean(record)
}
