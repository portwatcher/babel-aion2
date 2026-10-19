import type { OutputLanguage } from './languages.ts'
import { z } from 'zod'
import { voiceSourceStateSchema } from './voice-source.ts'
import { roomNumberSchema } from './lobby.ts'

const publicAudioStateSchema = voiceSourceStateSchema.or(z.literal('UNCONFIGURED'))

export const publicRoomConfigurationSchema: z.ZodType<PublicRoomConfiguration> =
  z.object({
    room: z.object({
      id: z.uuid(),
      number: roomNumberSchema.optional(),
      name: z.string(),
      audioState: publicAudioStateSchema,
      hostId: z.string().optional(),
    }),
    outputLanguages: z.array(z.object({ code: z.string(), name: z.string() })),
    defaultOutputLanguage: z.string().nullable(),
    entryAvailable: z.boolean(),
    admission: z.object({ server: z.string(), restricted: z.boolean() }).optional(),
  })

export interface PublicRoomConfiguration {
  room: {
    id: string
    number?: number
    name: string
    audioState: z.infer<typeof publicAudioStateSchema>
    // The community room's host character, who may close the room.
    hostId?: string
  }
  outputLanguages: OutputLanguage[]
  defaultOutputLanguage: string | null
  entryAvailable: boolean
  admission?: { server: string; restricted: boolean }
}

export type ListenerState =
  'JOINING' | 'ACTIVE' | 'DISCONNECTING' | 'REPLACED' | 'REMOVED' | 'EXPIRED'
