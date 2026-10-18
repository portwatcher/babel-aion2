import type { ListenerReference, TerminalReason } from '@babel/contracts'
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { auditEvent, listenerSession, nickname } from '../schema/rooms.ts'
import { requireOutputLanguage } from './entry.ts'
import {
  ListenerError,
  type ListenerRecord,
  type Transaction,
  verifyCredential,
} from './model.ts'

async function lockCurrent(tx: Transaction, record: ListenerRecord) {
  const [current] = await tx
    .select()
    .from(nickname)
    .where(eq(nickname.key, record.nicknameKey))
    .for('update')
  const [fresh] = await tx
    .select()
    .from(listenerSession)
    .where(eq(listenerSession.id, record.id))
  if (
    !fresh ||
    current?.currentSessionId !== record.id ||
    current.generation !== record.nicknameGeneration ||
    !['JOINING', 'ACTIVE'].includes(fresh.state) ||
    fresh.revokedAt
  ) {
    throw new ListenerError('SESSION_ENDED')
  }
  return fresh
}

export async function readAuthenticated(db: Database, id: string, credential: string) {
  const [record] = await db
    .select()
    .from(listenerSession)
    .where(eq(listenerSession.id, id))
  return verifyCredential(record, credential)
}

export async function updateSubscription(
  db: Database,
  id: string,
  credential: string,
  code: string | null,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, id))
    const current = await lockCurrent(tx, verifyCredential(record, credential))
    await requireOutputLanguage(tx, code)
    const [updated] = await tx
      .update(listenerSession)
      .set({
        outputLanguage: code,
        subscriptionVersion:
          current.subscriptionVersion + (code === current.outputLanguage ? 0 : 1),
      })
      .where(eq(listenerSession.id, id))
      .returning()
    return updated ?? current
  })
}

export async function heartbeat(db: Database, id: string, credential: string) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, id))
    const current = await lockCurrent(tx, verifyCredential(record, credential))
    const [updated] = await tx
      .update(listenerSession)
      .set({ lastSeenAt: new Date() })
      .where(eq(listenerSession.id, id))
      .returning()
    return updated ?? current
  })
}

export async function requestRemoval(
  db: Database,
  reference: ListenerReference,
  reason: Exclude<TerminalReason, 'DUPLICATE_NICKNAME_REPLACED'>,
  actorSubject?: string,
  inactiveBefore?: Date,
) {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(listenerSession)
      .where(
        and(
          eq(listenerSession.id, reference.sessionId),
          eq(listenerSession.nicknameGeneration, reference.nicknameGeneration),
        ),
      )
    if (!original) {
      return
    }
    await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, original.nicknameKey))
      .for('update')
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, original.id))
    if (
      !record ||
      record.revokedAt ||
      (inactiveBefore && record.lastSeenAt >= inactiveBefore)
    ) {
      return record
    }
    const [removed] = await tx
      .update(listenerSession)
      .set({
        state: reason === 'CONNECTION_EXPIRED' ? 'EXPIRED' : 'REMOVED',
        terminalReason: reason,
        revokedAt: new Date(),
      })
      .where(eq(listenerSession.id, record.id))
      .returning()
    if (actorSubject) {
      await tx.insert(auditEvent).values({
        actorSubject,
        action: 'listener.remove',
        resourceId: record.id,
        metadata: { nicknameGeneration: record.nicknameGeneration, reason },
      })
    }
    return removed
  })
}

export async function confirmDeliveryStopped(
  db: Database,
  reference: ListenerReference,
) {
  // The coordinator is the sole production caller. It reaches this write only
  // after BOTH transports acknowledge shutdown and deny future reconnections.
  await db
    .update(listenerSession)
    .set({ deliveryStoppedAt: new Date() })
    .where(
      and(
        eq(listenerSession.id, reference.sessionId),
        eq(listenerSession.nicknameGeneration, reference.nicknameGeneration),
        isNotNull(listenerSession.revokedAt),
        isNull(listenerSession.deliveryStoppedAt),
      ),
    )
}

export async function pendingRemovals(db: Database, key?: string) {
  return db
    .select()
    .from(listenerSession)
    .where(
      and(
        isNotNull(listenerSession.revokedAt),
        isNull(listenerSession.deliveryStoppedAt),
        key === undefined ? undefined : eq(listenerSession.nicknameKey, key),
      ),
    )
}

export async function inactiveListeners(db: Database, inactiveBefore: Date) {
  return db
    .select()
    .from(listenerSession)
    .where(
      and(
        inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
        lt(listenerSession.lastSeenAt, inactiveBefore),
      ),
    )
}
