import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from './client.ts'
import { runtimeOwner } from './schema/runtime-owners.ts'
import { runtimePod, type RuntimePodExitEvidence } from './schema/runtime-pods.ts'
import { closeRuntimeOwner, RuntimeOwnerUnavailable } from './runtime-owner-closure.ts'

export interface RuntimePodIdentity {
  uid: string
  namespace: string
  name: string
}

export class RuntimePodRetirementRequired extends Error {
  constructor() {
    super('Runtime Pod requires confirmed retirement')
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

async function lockPod(tx: Transaction, identity: RuntimePodIdentity) {
  await tx.insert(runtimePod).values(identity).onConflictDoNothing()
  const [pod] = await tx
    .select()
    .from(runtimePod)
    .where(eq(runtimePod.uid, identity.uid))
    .for('update')
  if (!pod || pod.name !== identity.name || pod.namespace !== identity.namespace) {
    throw new RuntimeOwnerUnavailable()
  }
  return pod
}

export async function registerPodRuntime(
  db: Database,
  id: string,
  identity: RuntimePodIdentity,
) {
  const admitted = await db.transaction(async (tx) => {
    const pod = await lockPod(tx, identity)
    if (pod.retirementRequestedAt || pod.retiredAt) {
      return false
    }
    const [existing] = await tx
      .select()
      .from(runtimeOwner)
      .where(eq(runtimeOwner.id, id))
    if (existing) {
      if (existing.exitedAt || existing.podUid !== identity.uid) {
        throw new RuntimeOwnerUnavailable()
      }
      return true
    }
    const [previous] = await tx
      .select({ id: runtimeOwner.id })
      .from(runtimeOwner)
      .where(and(eq(runtimeOwner.podUid, identity.uid), isNull(runtimeOwner.exitedAt)))
      .limit(1)
    if (previous) {
      // A new supervisor cannot attest to the previous supervisor's child exit.
      // Commit this request before reporting failure; never replace its receipt.
      await tx
        .update(runtimePod)
        .set({ retirementRequestedAt: new Date() })
        .where(eq(runtimePod.uid, identity.uid))
      return false
    }
    await tx.insert(runtimeOwner).values({ id, podUid: identity.uid })
    return true
  })
  if (!admitted) {
    throw new RuntimePodRetirementRequired()
  }
}

export async function requestedRuntimePodRetirements(db: Database, namespace: string) {
  return db
    .select({
      uid: runtimePod.uid,
      namespace: runtimePod.namespace,
      name: runtimePod.name,
    })
    .from(runtimePod)
    .where(
      and(
        eq(runtimePod.namespace, namespace),
        isNotNull(runtimePod.retirementRequestedAt),
        isNull(runtimePod.retiredAt),
      ),
    )
}

// Deletion first seals admission. With no open owners, the existing supervisor
// receipts already prove delivery ended; even a delayed reservation cannot reopen it.
export async function sealRuntimePod(db: Database, identity: RuntimePodIdentity) {
  return db.transaction(async (tx) => {
    const pod = await lockPod(tx, identity)
    if (pod.retiredAt) {
      return true
    }
    await tx
      .update(runtimePod)
      .set({ retirementRequestedAt: pod.retirementRequestedAt ?? new Date() })
      .where(eq(runtimePod.uid, identity.uid))
    const [active] = await tx
      .select({ id: runtimeOwner.id })
      .from(runtimeOwner)
      .where(and(eq(runtimeOwner.podUid, identity.uid), isNull(runtimeOwner.exitedAt)))
      .limit(1)
    if (active) {
      return false
    }
    await tx
      .update(runtimePod)
      .set({ retiredAt: new Date(), exitEvidence: { kind: 'owners-exited' } })
      .where(eq(runtimePod.uid, identity.uid))
    return true
  })
}

// Only the private recovery controller may use independently verified kubelet
// termination evidence here. Missing Pods, age and ContainerStatusUnknown are not evidence.
export async function confirmRuntimePodExit(
  db: Database,
  identity: RuntimePodIdentity,
  evidence: Extract<RuntimePodExitEvidence, { kind: 'kubelet-terminated' }>,
) {
  await db.transaction(async (tx) => {
    const pod = await lockPod(tx, identity)
    if (pod.retiredAt) {
      return
    }
    const owners = await tx
      .select({ id: runtimeOwner.id })
      .from(runtimeOwner)
      .where(and(eq(runtimeOwner.podUid, identity.uid), isNull(runtimeOwner.exitedAt)))
      .orderBy(runtimeOwner.id)
    for (const owner of owners) {
      await closeRuntimeOwner(tx, owner.id)
    }
    const now = new Date()
    await tx
      .update(runtimePod)
      .set({
        retirementRequestedAt: pod.retirementRequestedAt ?? now,
        retiredAt: now,
        exitEvidence: evidence,
      })
      .where(eq(runtimePod.uid, identity.uid))
  })
}
