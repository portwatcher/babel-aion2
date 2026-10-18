import type { OutputLanguage } from './languages.ts'

export interface PublicRoomConfiguration {
  room: { id: string; name: string; audioState: 'UNCONFIGURED' | 'STOPPED' }
  outputLanguages: OutputLanguage[]
  defaultOutputLanguage: string | null
  entryAvailable: boolean
}

export type ListenerState =
  'JOINING' | 'ACTIVE' | 'DISCONNECTING' | 'REPLACED' | 'REMOVED' | 'EXPIRED'

export interface Subtitle {
  roomId: string
  sourceGeneration: number
  speakerId: string
  speakerDisplayName: string
  utteranceId: string
  sourceRevision: number
  translationRevision: number
  sequence: number
  sourceLanguage: string
  originalText: string
  outputLanguage: string
  translatedText: string
  sourceIsFinal: boolean
  translationIsFinal: boolean
  configurationVersion: number
  audioStartMs: number | null
  audioEndMs: number | null
  serverSentAt: string
  discontinuity: boolean
  failure: string | null
}
