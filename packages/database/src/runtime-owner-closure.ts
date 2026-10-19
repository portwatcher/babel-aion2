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

// Call inside a transaction, after the caller has confirmed physical process exit.
// Registration takes a shared owner lock; this exclusive lock fences late work.
export async function closeRuntimeOwner(
  tx: Pick<Database, 'select' | 'update'>,
  id: string,
) {
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
}
