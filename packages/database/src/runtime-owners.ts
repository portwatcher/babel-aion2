import { eq } from 'drizzle-orm'
import type { Database } from './client.ts'
import { runtimeOwner } from './schema/runtime-owners.ts'
import { closeRuntimeOwner, RuntimeOwnerUnavailable } from './runtime-owner-closure.ts'
import { registerPodRuntime, type RuntimePodIdentity } from './runtime-pods.ts'

export { RuntimeOwnerUnavailable } from './runtime-owner-closure.ts'

export async function registerRuntimeOwner(
  db: Database,
  id: string,
  pod?: RuntimePodIdentity,
) {
  if (pod) {
    return registerPodRuntime(db, id, pod)
  }
  await db.insert(runtimeOwner).values({ id }).onConflictDoNothing()
  const [owner] = await db.select().from(runtimeOwner).where(eq(runtimeOwner.id, id))
  if (!owner || owner.exitedAt || owner.podUid !== null) {
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
  await db.transaction((tx) => closeRuntimeOwner(tx, id))
}
