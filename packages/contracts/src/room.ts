import type { OutputLanguage } from './languages.ts'
import { z } from 'zod'
import { voiceSourceStateSchema } from './voice-source.ts'

const publicAudioStateSchema = voiceSourceStateSchema.or(z.literal('UNCONFIGURED'))

export const publicRoomConfigurationSchema: z.ZodType<PublicRoomConfiguration> =
  z.object({
    room: z.object({
      id: z.uuid(),
      name: z.string(),
      audioState: publicAudioStateSchema,
    }),
    outputLanguages: z.array(z.object({ code: z.string(), name: z.string() })),
    defaultOutputLanguage: z.string().nullable(),
    entryAvailable: z.boolean(),
  })

export interface PublicRoomConfiguration {
  room: { id: string; name: string; audioState: z.infer<typeof publicAudioStateSchema> }
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
