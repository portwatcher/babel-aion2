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
  // Browser render timing for a server-issued latency probe; no clock values.
  z
    .object({
      type: z.literal('subtitle-displayed'),
      probe: z.uuid(),
      renderDelayMs: z.number().nonnegative().max(60_000),
      visible: z.boolean(),
    })
    .strict(),
])

export const playerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subtitles'),
    subscriptionVersion: z.number().int().nonnegative(),
    outputLanguage: languageCodeSchema,
    event: subtitleMessageSchema,
    probe: z.uuid().optional(),
  }),
  z.object({ type: z.literal('session'), session: listenerSnapshotSchema }),
  z.object({ type: z.literal('players'), players: z.array(publicListenerSchema) }),
  z.object({
    type: z.literal('configuration'),
    configuration: publicRoomConfigurationSchema,
  }),
  // An opaque digest of the room's tactical map. Clients refetch when it changes.
  z.object({ type: z.literal('map'), revision: z.string().max(128) }),
  z.object({ type: z.literal('ping'), nonce: z.uuid() }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['INVALID_CREDENTIAL', 'INVALID_MESSAGE', 'UNAVAILABLE']),
  }),
])

export type PlayerEvent = z.infer<typeof playerEventSchema>
export type PlayerMessage = z.infer<typeof playerMessageSchema>
