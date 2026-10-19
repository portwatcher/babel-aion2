import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { roomAdmissionSchema } from '@babel/contracts'
import type { Database } from './client.ts'
import { auditEvent, listenerSession, nickname, room } from './schema/rooms.ts'
import { communityRoom } from './schema/room-community.ts'

export class RoomPublicationError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'SOURCE_UNCONFIGURED' | 'ALREADY_PUBLISHED',
  ) {
    super(code)
  }
}
export async function publishExistingRoom(
  db: Database,
  roomId: string,
  input: unknown,
  actor: string,
) {
  const policy = roomAdmissionSchema.parse(input)
  const allowedIds = [...new Set(policy.allowedIds.map((id) => id.normalize('NFC')))]
  return db.transaction(async (tx) => {
    // Entry takes a shared room lock before reading the admission policy. This
    // exclusive lock closes legacy entries that raced the one-time publication.
    const [stored] = await tx
      .select()
      .from(room)
      .where(eq(room.id, roomId))
      .for('update')
    if (!stored || stored.disbandedAt) {
      throw new RoomPublicationError('NOT_FOUND')
    }
    if (
      !stored.discordGuildId ||
      !stored.discordVoiceChannelId ||
      !stored.encryptedDiscordCredential
    ) {
      throw new RoomPublicationError('SOURCE_UNCONFIGURED')
    }
    const [existing] = await tx
      .select()
      .from(communityRoom)
      .where(eq(communityRoom.roomId, roomId))
    if (existing) {
      if (
        existing.server !== policy.server ||
        JSON.stringify(existing.allowedIds) !== JSON.stringify(allowedIds)
      ) {
        throw new RoomPublicationError('ALREADY_PUBLISHED')
      }
      return []
    }
    const guildId = stored.discordGuildId
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`babel:community-guild:${guildId}`}, 0))`,
    )
    const old = await tx
      .select()
      .from(listenerSession)
      .where(
        and(
          eq(listenerSession.roomId, roomId),
          inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
        ),
      )
    const keys = [...new Set(old.map((record) => record.nicknameKey))]
    if (keys.length) {
      await tx
        .select()
        .from(nickname)
        .where(inArray(nickname.key, keys))
        .orderBy(asc(nickname.key))
        .for('update')
    }
    await tx
      .insert(communityRoom)
      .values({ roomId, guildId, creatorId: actor, server: policy.server, allowedIds })
    if (old.length) {
      await tx
        .update(listenerSession)
        .set({
          state: 'REMOVED',
          revokedAt: new Date(),
          terminalReason: 'ADMINISTRATOR_REMOVED',
        })
        .where(
          and(
            inArray(
              listenerSession.id,
              old.map((record) => record.id),
            ),
            inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
          ),
        )
    }
    await tx.insert(auditEvent).values({
      actorSubject: actor,
      action: 'room.publish',
      resourceId: roomId,
      metadata: {
        server: policy.server,
        restricted: allowedIds.length > 0,
        listenersRequiringEntry: old.length,
      },
    })
    return old.map((record) => ({
      sessionId: record.id,
      nicknameGeneration: record.nicknameGeneration,
    }))
  })
}
