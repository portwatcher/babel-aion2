import { z } from 'zod'
import type { ListenerState } from './room.ts'

export const listenerCredentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const listenerReferenceSchema = z.object({
  sessionId: z.uuid(),
  nicknameGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export const languageChangeSchema = z.object({ outputLanguage: z.string().nullable() })

export type TerminalReason =
  | 'DUPLICATE_NICKNAME_REPLACED'
  | 'ADMINISTRATOR_REMOVED'
  | 'PLAYER_LEFT'
  | 'CONNECTION_EXPIRED'

export interface ListenerReference {
  sessionId: string
  nicknameGeneration: number
}

export interface ListenerSnapshot extends ListenerReference {
  roomId: string
  nickname: string
  state: ListenerState
  terminalReason: TerminalReason | null
  outputLanguage: string | null
  subscriptionVersion: number
  joinedAt: string
}

export interface PublicListener {
  sessionId: string
  nickname: string
  joinedAt: string
  state: 'JOINING' | 'ACTIVE' | 'DISCONNECTING'
}

export interface ManagementListener extends PublicListener {
  nicknameGeneration: number
}
