import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import type { Database } from './client.ts'
import { room } from './schema/rooms.ts'
import { voiceSourceRun } from './schema/voice-sources.ts'
import { lockRuntimeOwner } from './runtime-owners.ts'

export type VoiceSourceConfiguration = typeof room.$inferSelect
export class VoiceSourceOwnershipError extends Error {
  constructor() {
    super('Voice source ownership unavailable')
  }
}

export function voiceSourceConfigured(source: VoiceSourceConfiguration) {
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

export async function claimVoiceSource(
  db: Database,
  pool: Pool,
  source: VoiceSourceConfiguration,
  botId: string,
  ownerId: string,
  lost: () => void,
) {
  const controlKey = `${botId}:${source.discordGuildId}`
  const client = await pool.connect()
  let released = false
  let invalid = false
  let checking = false
  let timer: ReturnType<typeof setInterval> | undefined
  function invalidate() {
    if (!invalid && !released) {
      invalid = true
      lost()
    }
  }
  client.on('error', invalidate)
  client.on('end', invalidate)
  async function release() {
    if (released) {
      return
    }
    released = true
    clearInterval(timer)
    client.off('end', invalidate)
    // Destroy this dedicated session. Returning it to the pool could retain a
    // session advisory lock; closing it always releases the lock on PostgreSQL.
    client.release(true)
  }
  try {
    const result = await boundedQuery<{ acquired: boolean }>(
      client,
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [controlKey],
    )
    if (!result.rows[0]?.acquired) {
      throw new VoiceSourceOwnershipError()
    }
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
    timer = setInterval(() => {
      if (checking || invalid || released) {
        return
      }
      checking = true
      void checkSession(client)
        .catch(invalidate)
        .finally(() => {
          checking = false
        })
    }, 500)
    timer.unref()
    return {
      source: claimed.source,
      valid: () => !invalid && !released,
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

async function checkSession(client: PoolClient) {
  await boundedQuery(client, 'select 1')
}

async function boundedQuery<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: string[] = [],
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      client.query<T>(text, values),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new VoiceSourceOwnershipError()), 1_500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
