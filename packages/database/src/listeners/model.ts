import { createHash, timingSafeEqual } from 'node:crypto'
import type { ListenerSnapshot } from '@babel/contracts'
import type { Database } from '../client.ts'
import { listenerSession } from '../schema/rooms.ts'

export type ListenerRecord = typeof listenerSession.$inferSelect
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export class ListenerError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CREDENTIAL'
      | 'ENTRY_CONFLICT'
      | 'LANGUAGE_UNAVAILABLE'
      | 'SESSION_ENDED'
      | 'ROOM_NOT_FOUND',
  ) {
    super(code)
  }
}

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function verifyCredential(
  record: ListenerRecord | undefined,
  credential: string,
) {
  const provided = Buffer.from(digest(credential), 'hex')
  const expected = Buffer.from(record?.credentialHash ?? '0'.repeat(64), 'hex')
  if (!timingSafeEqual(provided, expected) || !record) {
    throw new ListenerError('INVALID_CREDENTIAL')
  }
  return record
}

export function snapshot(record: ListenerRecord): ListenerSnapshot {
  return {
    sessionId: record.id,
    nicknameGeneration: record.nicknameGeneration,
    roomId: record.roomId,
    nickname: record.nickname,
    state: record.state,
    terminalReason: record.terminalReason,
    outputLanguage: record.outputLanguage,
    subscriptionVersion: record.subscriptionVersion,
    joinedAt: record.joinedAt.toISOString(),
  }
}
