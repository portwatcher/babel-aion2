import { z } from 'zod'
import { languageCodeSchema } from './languages.ts'
import { listenerReferenceSchema } from './listeners.ts'
import { providerTestCodeSchema } from './providers.ts'

export const subtitleSchema = z.object({
  roomId: z.uuid(),
  sourceGeneration: z.number().int().nonnegative(),
  streamGeneration: z.number().int().positive(),
  speakerId: z.string().min(1).max(80),
  speakerDisplayName: z.string().max(256),
  utteranceId: z.uuid(),
  sourceRevision: z.number().int().positive(),
  translationRevision: z.number().int().nonnegative(),
  sequence: z.number().int().positive(),
  sourceLanguage: z.string().min(2).max(35),
  originalText: z.string().max(4096),
  outputLanguage: languageCodeSchema,
  translatedText: z.string().max(16_384),
  sourceIsFinal: z.boolean(),
  translationIsFinal: z.boolean(),
  configurationVersion: z.number().int().positive(),
  sourceAlignment: z.enum(['aligned', 'independent']).optional(),
  audioStartMs: z.number().nonnegative().nullable(),
  audioEndMs: z.number().nonnegative().nullable(),
  serverSentAt: z.iso.datetime({ offset: true }),
  discontinuity: z.boolean(),
  failure: providerTestCodeSchema.exclude(['PASS']).nullable(),
})

export const subtitleMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subtitle'), value: subtitleSchema }),
  z.object({
    type: z.literal('subtitle-state'),
    roomId: z.uuid(),
    sourceGeneration: z.number().int().nonnegative(),
    speakerId: z.string().nullable(),
    streamGeneration: z.number().int().nonnegative(),
    outputLanguage: languageCodeSchema,
    state: z.enum(['WAITING', 'CONNECTING', 'UNAVAILABLE', 'STOPPED']),
    failure: providerTestCodeSchema.exclude(['PASS']).nullable(),
  }),
])

// The private worker verifies this against a live, registered player socket.
// A web server's control credential alone cannot select an arbitrary listener.
export const subtitleSubscriptionSchema = z
  .object({
    connectionId: z.uuid(),
    reference: listenerReferenceSchema,
    subscriptionVersion: z.number().int().nonnegative(),
  })
  .strict()

export type Subtitle = z.infer<typeof subtitleSchema>
export type SubtitleMessage = z.infer<typeof subtitleMessageSchema>
export type SubtitleSubscription = z.infer<typeof subtitleSubscriptionSchema>
