import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  playerRoomCreationSchema,
  roomInstallSchema,
  type RoomDirectory,
} from '@babel/contracts'
import type { Database } from './client.ts'
import type { CredentialCipher } from './credentials.ts'
import { auditEvent, listenerSession, room } from './schema/rooms.ts'
import { communityRoom, roomInstallation } from './schema/room-community.ts'
import { voiceSourceConfigured } from './voice-sources.ts'

export const hashInstallationSecret = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export class CommunityRoomError extends Error {
  constructor(readonly code: 'INVALID_INSTALLATION' | 'SOURCE_CHANNEL_CONFLICT') {
    super(code)
  }
}

async function readGuildSource(db: Pick<Database, 'select'>, guildId: string) {
  const sources = await db
    .select()
    .from(room)
    .where(eq(room.discordGuildId, guildId))
    .orderBy(asc(room.createdAt), asc(room.id))
  return sources.find(voiceSourceConfigured)
}

async function creationResult(db: Pick<Database, 'select'>, roomId: string) {
  const [record] = await db
    .select({ roomNumber: communityRoom.number })
    .from(communityRoom)
    .where(eq(communityRoom.roomId, roomId))
  if (!record) {
    throw new CommunityRoomError('INVALID_INSTALLATION')
  }
  return { roomId, roomNumber: record.roomNumber }
}

export async function beginInstallation(db: Database, input: unknown) {
  const request = roomInstallSchema.parse(input)
  const state = randomBytes(32).toString('base64url')
  const browser = randomBytes(32).toString('base64url')
  const [record] = await db
    .insert(roomInstallation)
    .values({
      ...request,
      allowedIds: [...new Set(request.allowedIds.map((id) => id.normalize('NFC')))],
      stateHash: hashInstallationSecret(state),
      browserHash: hashInstallationSecret(browser),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    })
    .returning({ id: roomInstallation.id })
  if (!record) {
    throw new CommunityRoomError('INVALID_INSTALLATION')
  }
  return { id: record.id, state, browser }
}

export async function readInstallation(db: Database, id: string, browser: string) {
  const [record] = await db
    .select()
    .from(roomInstallation)
    .where(
      and(
        eq(roomInstallation.id, id),
        eq(roomInstallation.browserHash, hashInstallationSecret(browser)),
        gt(roomInstallation.expiresAt, new Date()),
      ),
    )
  if (!record) {
    throw new CommunityRoomError('INVALID_INSTALLATION')
  }
  const source =
    record.authorizedAt && record.guildId
      ? await readGuildSource(db, record.guildId)
      : undefined
  const consumed = record.consumedRoomId
    ? await creationResult(db, record.consumedRoomId)
    : null
  return {
    ...record,
    consumedRoomNumber: consumed?.roomNumber ?? null,
    sharedVoiceChannelId: source?.discordVoiceChannelId ?? null,
  }
}

export async function completeInstallation(
  db: Database,
  id: string,
  browser: string,
  state: string,
  identity: { guildId: string; creatorId: string },
) {
  const [updated] = await db
    .update(roomInstallation)
    .set({ ...identity, authorizedAt: new Date() })
    .where(
      and(
        eq(roomInstallation.id, id),
        eq(roomInstallation.browserHash, hashInstallationSecret(browser)),
        eq(roomInstallation.stateHash, hashInstallationSecret(state)),
        gt(roomInstallation.expiresAt, new Date()),
        isNull(roomInstallation.authorizedAt),
      ),
    )
    .returning()
  if (!updated) {
    throw new CommunityRoomError('INVALID_INSTALLATION')
  }
  return updated
}

export async function createCommunityRoom(
  db: Database,
  id: string,
  browser: string,
  voiceChannelId: string,
  cipher: CredentialCipher,
  botToken: string,
) {
  return db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(roomInstallation)
      .where(
        and(
          eq(roomInstallation.id, id),
          eq(roomInstallation.browserHash, hashInstallationSecret(browser)),
          gt(roomInstallation.expiresAt, new Date()),
        ),
      )
      .for('update')
    if (
      !installation?.guildId ||
      !installation.creatorId ||
      !installation.authorizedAt
    ) {
      throw new CommunityRoomError('INVALID_INSTALLATION')
    }
    if (installation.consumedRoomId) {
      return creationResult(tx, installation.consumedRoomId)
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`babel:community-guild:${installation.guildId}`}, 0))`,
    )
    const existing = await readGuildSource(tx, installation.guildId)
    if (
      existing?.discordVoiceChannelId &&
      existing.discordVoiceChannelId !== voiceChannelId
    ) {
      throw new CommunityRoomError('SOURCE_CHANNEL_CONFLICT')
    }
    const roomId = randomUUID()
    await tx.insert(room).values({
      id: roomId,
      name: installation.name,
      discordGuildId: installation.guildId,
      discordVoiceChannelId: voiceChannelId,
      captureMode: existing?.captureMode ?? 'ALL_CHANNEL',
      commanderIds: existing?.commanderIds ?? [],
      stopped: false,
      sourceGeneration: 1,
      encryptedDiscordCredential: cipher.encrypt(botToken, `room:${roomId}:discord`),
    })
    await tx.insert(communityRoom).values({
      roomId,
      guildId: installation.guildId,
      creatorId: installation.creatorId,
      server: installation.server,
      allowedIds: installation.allowedIds,
    })
    await tx
      .update(roomInstallation)
      .set({ consumedRoomId: roomId })
      .where(eq(roomInstallation.id, id))
    await tx.insert(auditEvent).values({
      actorSubject: `discord:${installation.creatorId}`,
      action: 'room.create',
      resourceId: roomId,
      metadata: {
        server: installation.server,
        restricted: installation.allowedIds.length > 0,
      },
    })
    return creationResult(tx, roomId)
  })
}

/**
 * Creates a room whose audio comes from the host character's own listener
 * session. The caller verifies the host character before calling.
 */
export async function createPlayerRoom(db: Database, input: unknown) {
  const request = playerRoomCreationSchema.parse(input)
  const hostId = request.hostId.normalize('NFC')
  const allowedIds = [...new Set(request.allowedIds.map((id) => id.normalize('NFC')))]
  if (allowedIds.length && !allowedIds.includes(hostId)) {
    allowedIds.push(hostId)
  }
  return db.transaction(async (tx) => {
    const roomId = randomUUID()
    await tx.insert(room).values({
      id: roomId,
      name: request.name,
      audioSource: 'PLAYER',
      hostCharacterId: hostId,
      captureMode: 'ALL_CHANNEL',
      stopped: false,
      sourceGeneration: 1,
    })
    await tx.insert(communityRoom).values({
      roomId,
      server: request.server,
      allowedIds,
    })
    await tx.insert(auditEvent).values({
      actorSubject: 'player:room-host',
      action: 'room.create',
      resourceId: roomId,
      metadata: {
        server: request.server,
        restricted: allowedIds.length > 0,
        audioSource: 'PLAYER',
      },
    })
    return creationResult(tx, roomId)
  })
}

export async function listCommunityRooms(
  db: Database,
): Promise<RoomDirectory['rooms']> {
  const rooms = await db
    .select({
      id: room.id,
      number: communityRoom.number,
      name: room.name,
      stopped: room.stopped,
      server: communityRoom.server,
      allowedIds: communityRoom.allowedIds,
    })
    .from(room)
    .innerJoin(communityRoom, eq(communityRoom.roomId, room.id))
    .where(isNull(room.disbandedAt))
    .orderBy(asc(room.createdAt), asc(room.id))
  const counts = await db
    .select({ roomId: listenerSession.roomId, total: count() })
    .from(listenerSession)
    .where(inArray(listenerSession.state, ['JOINING', 'ACTIVE']))
    .groupBy(listenerSession.roomId)
  const byRoom = new Map(counts.map((item) => [item.roomId, item.total]))
  return rooms.map(({ allowedIds, ...item }) => ({
    ...item,
    memberCount: byRoom.get(item.id) ?? 0,
    restricted: allowedIds.length > 0,
  }))
}
