import { randomUUID } from 'node:crypto'
import {
  entryRequestSchema,
  listenerCredentialSchema,
  nicknameKey,
  type CharacterProfile,
} from '@babel/contracts'
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { listenerSession, nickname, outputLanguage, room } from '../schema/rooms.ts'
import { communityRoom, listenerCharacter } from '../schema/room-community.ts'
import { digest, ListenerError, type Transaction, verifyCredential } from './model.ts'

export async function requireOutputLanguage(tx: Transaction, code: string | null) {
  if (code === null) {
    return
  }
  const [language] = await tx
    .select()
    .from(outputLanguage)
    .where(
      and(
        eq(outputLanguage.code, code),
        eq(outputLanguage.enabled, true),
        isNotNull(outputLanguage.pathValidatedAt),
      ),
    )
    .for('share')
  if (!language) {
    throw new ListenerError('LANGUAGE_UNAVAILABLE')
  }
}

export async function prepareEntry(
  db: Database,
  roomId: string,
  body: unknown,
  credential: string,
  character?: CharacterProfile,
) {
  const request = entryRequestSchema.parse(body)
  listenerCredentialSchema.parse(credential)
  const fingerprint = digest(JSON.stringify({ roomId, ...request }))
  return db.transaction(async (tx) => {
    // Request lock precedes nickname lock: even retries that change the nickname
    // cannot compete for the same request ID or replace an unrelated session.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`babel:entry:${request.requestId}`}, 0))`,
    )
    const [existing] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.requestId, request.requestId))
    if (existing) {
      verifyCredential(existing, credential)
      if (existing.requestFingerprint !== fingerprint) {
        throw new ListenerError('ENTRY_CONFLICT')
      }
      return existing
    }
    // One credential belongs to exactly one entry; never adopt another session.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`babel:credential:${digest(credential)}`}, 0))`,
    )
    const [usedCredential] = await tx
      .select({ id: listenerSession.id })
      .from(listenerSession)
      .where(eq(listenerSession.credentialHash, digest(credential)))
    if (usedCredential) {
      throw new ListenerError('ENTRY_CONFLICT')
    }
    const [destination] = await tx
      .select({ id: room.id })
      .from(room)
      .where(and(eq(room.id, roomId), isNull(room.disbandedAt)))
      .for('share')
    if (!destination) {
      throw new ListenerError('ROOM_NOT_FOUND')
    }
    const [community] = await tx
      .select()
      .from(communityRoom)
      .where(eq(communityRoom.roomId, roomId))
    const characterKey = nicknameKey(request.nickname)
    if (
      community &&
      (!character ||
        character.region !== 'as' ||
        character.server !== community.server ||
        nicknameKey(character.nickname) !== characterKey ||
        (community.allowedIds.length > 0 &&
          !community.allowedIds.includes(characterKey)))
    ) {
      throw new ListenerError('CHARACTER_CHECK_REQUIRED')
    }
    const key = community ? `room:${roomId}:${characterKey}` : characterKey
    await requireOutputLanguage(tx, request.outputLanguage)
    await tx.insert(nickname).values({ key }).onConflictDoNothing()
    const [current] = await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, key))
      .for('update')
    if (!current || !Number.isSafeInteger(current.generation + 1)) {
      throw new ListenerError('ENTRY_CONFLICT')
    }
    if (current.currentSessionId) {
      await tx
        .update(listenerSession)
        .set({
          state: 'REPLACED',
          terminalReason: 'DUPLICATE_NICKNAME_REPLACED',
          revokedAt: new Date(),
        })
        .where(
          and(
            eq(listenerSession.id, current.currentSessionId),
            inArray(listenerSession.state, ['JOINING', 'ACTIVE']),
          ),
        )
    }
    const id = randomUUID()
    const generation = current.generation + 1
    const [created] = await tx
      .insert(listenerSession)
      .values({
        id,
        roomId,
        nickname: request.nickname,
        nicknameKey: key,
        nicknameGeneration: generation,
        requestId: request.requestId,
        requestFingerprint: fingerprint,
        credentialHash: digest(credential),
        outputLanguage: request.outputLanguage,
      })
      .returning()
    await tx
      .update(nickname)
      .set({ generation, currentSessionId: id })
      .where(eq(nickname.key, key))
    if (!created) {
      throw new Error('Listener entry was not persisted')
    }
    if (character) {
      await tx.insert(listenerCharacter).values({ sessionId: id, profile: character })
    }
    return created
  })
}

export async function activateCurrent(
  db: Database,
  sessionId: string,
  generation: number,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, sessionId))
    if (!record) {
      return
    }
    const [current] = await tx
      .select()
      .from(nickname)
      .where(eq(nickname.key, record.nicknameKey))
      .for('update')
    if (current?.currentSessionId !== sessionId || current.generation !== generation) {
      return
    }
    // Check every older unconfirmed removal, including ones skipped by a rapid
    // second replacement. Acknowledging only the immediate predecessor is unsafe.
    const [pending] = await tx
      .select({ id: listenerSession.id })
      .from(listenerSession)
      .where(
        and(
          or(
            eq(listenerSession.nicknameKey, record.nicknameKey),
            and(
              eq(listenerSession.roomId, record.roomId),
              eq(listenerSession.nicknameKey, nicknameKey(record.nickname)),
            ),
          ),
          ne(listenerSession.id, sessionId),
          isNull(listenerSession.deliveryStoppedAt),
        ),
      )
      .limit(1)
    if (pending) {
      return
    }
    await tx
      .update(listenerSession)
      .set({ state: 'ACTIVE' })
      .where(
        and(
          eq(listenerSession.id, sessionId),
          eq(listenerSession.nicknameGeneration, generation),
          eq(listenerSession.state, 'JOINING'),
          isNull(listenerSession.revokedAt),
        ),
      )
  })
}
