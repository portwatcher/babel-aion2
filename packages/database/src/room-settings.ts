import {
  roomUpdateSchema,
  type ManagementRoom,
  type RoomUpdate,
} from '@babel/contracts'
import { eq } from 'drizzle-orm'
import type { Database } from './client.ts'
import type { CredentialCipher } from './credentials.ts'
import { CredentialProtectionError } from './credentials.ts'
import { auditEvent, room } from './schema/rooms.ts'
import { voiceSourceConfigured } from './voice-sources.ts'

type StoredRoom = typeof room.$inferSelect
export class RoomConfigurationError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'INVALID_CONFIGURATION',
  ) {
    super(code)
  }
}

function publicSettings(stored: StoredRoom): ManagementRoom {
  return {
    id: stored.id,
    name: stored.name,
    stopped: stored.stopped,
    sourceGeneration: stored.sourceGeneration,
    version: stored.configurationVersion,
    guildId: stored.discordGuildId,
    voiceChannelId: stored.discordVoiceChannelId,
    captureMode: stored.captureMode,
    commanderIds: stored.commanderIds,
    credentialConfigured: Boolean(stored.encryptedDiscordCredential),
    sourceConfigured: Boolean(
      stored.discordGuildId &&
      stored.discordVoiceChannelId &&
      (stored.captureMode === 'ALL_CHANNEL' || stored.commanderIds.length > 0) &&
      stored.encryptedDiscordCredential,
    ),
    updatedAt: stored.updatedAt.toISOString(),
  }
}

export async function readRoomSettings(db: Database, roomId: string) {
  const [stored] = await db.select().from(room).where(eq(room.id, roomId))
  if (!stored) {
    throw new RoomConfigurationError('NOT_FOUND')
  }
  return publicSettings(stored)
}

export async function updateRoomSettings(
  db: Database,
  roomId: string,
  update: RoomUpdate,
  actor: string,
  cipher: CredentialCipher | null,
) {
  const parsed = roomUpdateSchema.safeParse(update)
  if (!parsed.success) {
    throw new RoomConfigurationError('INVALID_CONFIGURATION')
  }
  const input = parsed.data
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(room)
      .where(eq(room.id, roomId))
      .for('update')
    if (!stored) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    if (stored.configurationVersion !== input.expectedVersion) {
      throw new RoomConfigurationError('VERSION_CONFLICT')
    }
    const context = `room:${roomId}:discord`
    let encryptedCredential = stored.encryptedDiscordCredential
    if (input.removeCredential) {
      encryptedCredential = null
    } else if (input.credential) {
      if (!cipher) {
        throw new CredentialProtectionError()
      }
      encryptedCredential = cipher.encrypt(input.credential, context)
    } else if (encryptedCredential) {
      if (!cipher) {
        throw new CredentialProtectionError()
      }
      // Refuse to save a configuration whose retained credential is unreadable.
      cipher.decrypt(encryptedCredential, context)
    }
    const sourceChanged =
      stored.discordGuildId !== input.guildId ||
      stored.discordVoiceChannelId !== input.voiceChannelId ||
      stored.captureMode !== input.captureMode ||
      JSON.stringify([...stored.commanderIds].sort()) !==
        JSON.stringify([...input.commanderIds].sort()) ||
      stored.encryptedDiscordCredential !== encryptedCredential
    const [updated] = await tx
      .update(room)
      .set({
        name: input.name,
        discordGuildId: input.guildId,
        discordVoiceChannelId: input.voiceChannelId,
        captureMode: input.captureMode,
        commanderIds: input.commanderIds,
        encryptedDiscordCredential: encryptedCredential,
        stopped: sourceChanged ? true : stored.stopped,
        sourceGeneration: stored.sourceGeneration + (sourceChanged ? 1 : 0),
        configurationVersion: stored.configurationVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(room.id, roomId))
      .returning()
    if (!updated) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    await tx.insert(auditEvent).values({
      actorSubject: actor,
      action: 'room.configure',
      resourceId: roomId,
      metadata: {
        version: updated.configurationVersion,
        sourceGeneration: updated.sourceGeneration,
        credentialChanged: stored.encryptedDiscordCredential !== encryptedCredential,
      },
    })
    return publicSettings(updated)
  })
}

export async function startRoom(
  db: Database,
  roomId: string,
  expectedVersion: number,
  actor: string,
  cipher: CredentialCipher | null,
) {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(room)
      .where(eq(room.id, roomId))
      .for('update')
    if (!stored) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    if (stored.configurationVersion !== expectedVersion) {
      throw new RoomConfigurationError('VERSION_CONFLICT')
    }
    if (!voiceSourceConfigured(stored)) {
      throw new RoomConfigurationError('INVALID_CONFIGURATION')
    }
    if (!cipher || !stored.encryptedDiscordCredential) {
      throw new CredentialProtectionError()
    }
    cipher.decrypt(stored.encryptedDiscordCredential, `room:${roomId}:discord`)
    if (!stored.stopped) {
      return publicSettings(stored)
    }
    const [updated] = await tx
      .update(room)
      .set({
        stopped: false,
        sourceGeneration: stored.sourceGeneration + 1,
        configurationVersion: stored.configurationVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(room.id, roomId))
      .returning()
    if (!updated) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    await tx.insert(auditEvent).values({
      actorSubject: actor,
      action: 'room.start',
      resourceId: roomId,
      metadata: {
        version: updated.configurationVersion,
        sourceGeneration: updated.sourceGeneration,
      },
    })
    return publicSettings(updated)
  })
}

export async function stopRoom(
  db: Database,
  roomId: string,
  expectedVersion: number,
  actor: string,
) {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(room)
      .where(eq(room.id, roomId))
      .for('update')
    if (!stored) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    if (stored.configurationVersion !== expectedVersion) {
      throw new RoomConfigurationError('VERSION_CONFLICT')
    }
    if (stored.stopped) {
      return publicSettings(stored)
    }
    const [updated] = await tx
      .update(room)
      .set({
        stopped: true,
        sourceGeneration: stored.sourceGeneration + 1,
        configurationVersion: stored.configurationVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(room.id, roomId))
      .returning()
    if (!updated) {
      throw new RoomConfigurationError('NOT_FOUND')
    }
    await tx.insert(auditEvent).values({
      actorSubject: actor,
      action: 'room.stop',
      resourceId: roomId,
      metadata: {
        version: updated.configurationVersion,
        sourceGeneration: updated.sourceGeneration,
      },
    })
    return publicSettings(updated)
  })
}
