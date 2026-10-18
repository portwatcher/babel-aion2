import { z } from 'zod'
import {
  listenerCredentialSchema,
  listenerSnapshotSchema,
  publicListenerSchema,
} from './listeners.ts'
import { publicRoomConfigurationSchema } from './room.ts'
import { subtitleMessageSchema } from './subtitles.ts'
import { languageCodeSchema } from './languages.ts'

// Credentials travel in the first WebSocket frame (WSS in production), not a URL.
export const playerMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('authenticate'),
      sessionId: z.uuid(),
      credential: listenerCredentialSchema,
    })
    .strict(),
  z.object({ type: z.literal('pong'), nonce: z.uuid() }).strict(),
])

export const playerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subtitles'),
    subscriptionVersion: z.number().int().nonnegative(),
    outputLanguage: languageCodeSchema,
    event: subtitleMessageSchema,
  }),
  z.object({ type: z.literal('session'), session: listenerSnapshotSchema }),
  z.object({ type: z.literal('players'), players: z.array(publicListenerSchema) }),
  z.object({
    type: z.literal('configuration'),
    configuration: publicRoomConfigurationSchema,
  }),
  z.object({ type: z.literal('ping'), nonce: z.uuid() }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['INVALID_CREDENTIAL', 'INVALID_MESSAGE', 'UNAVAILABLE']),
  }),
])

export type PlayerEvent = z.infer<typeof playerEventSchema>
export type PlayerMessage = z.infer<typeof playerMessageSchema>
