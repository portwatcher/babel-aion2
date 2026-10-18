import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from './client.ts'
import { mediaConnection } from './schema/media-connections.ts'
import { voiceSourceRun } from './schema/voice-sources.ts'
import { runtimeOwner } from './schema/runtime-owners.ts'
import { playerConnection } from './schema/player-connections.ts'

export class RuntimeOwnerUnavailable extends Error {
  constructor() {
    super('Runtime owner unavailable')
  }
}

export async function registerRuntimeOwner(db: Database, id: string) {
  await db.insert(runtimeOwner).values({ id }).onConflictDoNothing()
  if (!(await runtimeOwnerActive(db, id))) {
    throw new RuntimeOwnerUnavailable()
  }
}

export async function runtimeOwnerActive(db: Pick<Database, 'select'>, id: string) {
  const [owner] = await db.select().from(runtimeOwner).where(eq(runtimeOwner.id, id))
  return Boolean(owner && !owner.exitedAt)
}

export async function lockRuntimeOwner(tx: Pick<Database, 'select'>, id: string) {
  // Held by the registration transaction until commit. Concurrent admissions
  // may share this lock, but exit reconciliation must acquire its exclusive lock.
  const [owner] = await tx
    .select()
    .from(runtimeOwner)
    .where(eq(runtimeOwner.id, id))
    .for('share')
  if (!owner || owner.exitedAt) {
    throw new RuntimeOwnerUnavailable()
  }
}

export async function confirmRuntimeExit(db: Database, id: string) {
  // Only the supervisor that observes its own child's OS exit may call this.
  // Never infer exit from a PID lookup, lease, lost socket or wall-clock timeout.
  await db.transaction(async (tx) => {
    const [owner] = await tx
      .select()
      .from(runtimeOwner)
      .where(eq(runtimeOwner.id, id))
      .for('update')
    if (!owner) {
      throw new RuntimeOwnerUnavailable()
    }
    if (owner.exitedAt) {
      return
    }
    const now = new Date()
    await tx.update(runtimeOwner).set({ exitedAt: now }).where(eq(runtimeOwner.id, id))
    await tx
      .update(playerConnection)
      .set({ closedAt: now })
      .where(and(eq(playerConnection.ownerId, id), isNull(playerConnection.closedAt)))
    await tx
      .update(mediaConnection)
      .set({ closedAt: now })
      .where(and(eq(mediaConnection.ownerId, id), isNull(mediaConnection.closedAt)))
    await tx
      .update(voiceSourceRun)
      .set({ closedAt: now })
      .where(and(eq(voiceSourceRun.ownerId, id), isNull(voiceSourceRun.closedAt)))
  })
}
