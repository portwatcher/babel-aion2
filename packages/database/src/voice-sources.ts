import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { Database } from './client.ts'
import { room } from './schema/rooms.ts'
import { voiceSourceRun } from './schema/voice-sources.ts'
import { lockRuntimeOwner } from './runtime-owners.ts'
import { lockVoiceSource, VoiceSourceOwnershipError } from './source-locks.ts'

export type VoiceSourceConfiguration = typeof room.$inferSelect
export { VoiceSourceOwnershipError } from './source-locks.ts'

export function voiceSourceConfigured(source: VoiceSourceConfiguration) {
  if (source.audioSource === 'PLAYER') {
    return Boolean(source.hostCharacterId)
  }
  return Boolean(
    source.discordGuildId &&
    source.discordVoiceChannelId &&
    source.encryptedDiscordCredential &&
    (source.captureMode === 'ALL_CHANNEL' || source.commanderIds.length > 0),
  )
}

export async function readVoiceSources(db: Database) {
  return db.select().from(room).orderBy(asc(room.createdAt), asc(room.id))
}

export async function readVoiceSourceGroups(db: Database) {
  const groups = new Map<string, VoiceSourceConfiguration[]>()
  for (const configuration of await readVoiceSources(db)) {
    const key = configuration.discordGuildId ?? configuration.id
    const rooms = groups.get(key) ?? []
    rooms.push(configuration)
    groups.set(key, rooms)
  }
  return [...groups.values()].map((rooms) => {
    const source = rooms.find(voiceSourceConfigured) ?? rooms[0]!
    return {
      configuration: { ...source, stopped: rooms.every((room) => room.stopped) },
      rooms,
    }
  })
}

/** The exact host character whose media peer may publish a room's audio. */
export async function readUplinkHost(db: Pick<Database, 'select'>, roomId: string) {
  const [record] = await db
    .select({ host: room.hostCharacterId })
    .from(room)
    .where(
      and(
        eq(room.id, roomId),
        eq(room.audioSource, 'PLAYER'),
        eq(room.stopped, false),
        isNull(room.disbandedAt),
      ),
    )
  return record?.host ?? null
}

export async function claimVoiceSource(
  db: Database,
  pool: Pool,
  source: VoiceSourceConfiguration,
  botId: string | null,
  ownerId: string,
  lost: () => void,
) {
  // Discord receivers are exclusive per bot and guild; a player source is
  // exclusive per room because its only input is that room's host peer.
  const controlKey =
    source.audioSource === 'PLAYER'
      ? `player:${source.id}`
      : `${botId}:${source.discordGuildId}`
  let invalid = false
  // Every source of this process shares one dedicated lock session.
  // Called only when the shared session is lost, never on an orderly release.
  const lock = await lockVoiceSource(pool, controlKey, () => {
    if (!invalid) {
      invalid = true
      lost()
    }
  })
  async function release() {
    await lock.release()
  }
  try {
    const claimed = await db.transaction(async (tx) => {
      await lockRuntimeOwner(tx, ownerId)
      const [current] = await tx
        .select()
        .from(room)
        .where(eq(room.id, source.id))
        .for('update')
      const [running] = await tx
        .select({ id: room.id })
        .from(room)
        .where(
          and(
            source.discordGuildId
              ? eq(room.discordGuildId, source.discordGuildId)
              : eq(room.id, source.id),
            eq(room.stopped, false),
          ),
        )
        .limit(1)
      if (
        !current ||
        !running ||
        current.sourceGeneration !== source.sourceGeneration ||
        !voiceSourceConfigured(current)
      ) {
        throw new VoiceSourceOwnershipError()
      }
      const [old] = await tx
        .select({ id: voiceSourceRun.id })
        .from(voiceSourceRun)
        .where(
          and(
            or(
              eq(voiceSourceRun.controlKey, controlKey),
              eq(voiceSourceRun.roomId, source.id),
            ),
            isNull(voiceSourceRun.closedAt),
          ),
        )
        .limit(1)
      if (old || invalid) {
        throw new VoiceSourceOwnershipError()
      }
      const [next] = await tx
        .update(room)
        .set({
          sourceGeneration: current.sourceGeneration + 1,
          updatedAt: new Date(),
        })
        .where(eq(room.id, current.id))
        .returning()
      if (!next) {
        throw new VoiceSourceOwnershipError()
      }
      const runId = randomUUID()
      await tx.insert(voiceSourceRun).values({
        id: runId,
        roomId: current.id,
        sourceGeneration: next.sourceGeneration,
        controlKey,
        ownerId,
      })
      return { runId, source: { ...next, stopped: false } }
    })
    return {
      source: claimed.source,
      valid: () => !invalid && lock.valid(),
      abandon: release,
      async close() {
        // The caller must first stop publication and physically close both the
        // Discord receiver and the old room peers. A failed receipt stays open.
        try {
          await db
            .update(voiceSourceRun)
            .set({ closedAt: new Date() })
            .where(
              and(
                eq(voiceSourceRun.id, claimed.runId),
                eq(voiceSourceRun.ownerId, ownerId),
                isNull(voiceSourceRun.closedAt),
              ),
            )
        } finally {
          await release()
        }
      },
    }
  } catch (error) {
    await release()
    throw error
  }
}
