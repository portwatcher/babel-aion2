import { z } from 'zod'
import { listenerCredentialSchema, listenerReferenceSchema } from './listeners.ts'
import { mediaIceConfigurationSchema } from './media-network.ts'

export const mediaDescriptionSchema = z
  .object({
    type: z.literal('answer'),
    sdp: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict()
export const mediaRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('offer'),
      connectionId: z.uuid(),
      attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({
      operation: z.literal('answer'),
      connectionId: z.uuid(),
      description: mediaDescriptionSchema,
    })
    .strict(),
  z.object({ operation: z.literal('close'), connectionId: z.uuid() }).strict(),
])
export const mediaControlRequestSchema = z
  .object({
    reference: listenerReferenceSchema,
    credential: listenerCredentialSchema,
    request: mediaRequestSchema,
  })
  .strict()
export const mediaOfferSchema = z.object({
  connectionId: z.uuid(),
  ice: mediaIceConfigurationSchema.default({
    servers: [],
    policy: 'all',
    renewAfterMs: null,
  }),
  // Present only for a player-source room host: the transceiver that carries
  // the host's microphone to the worker. Other listeners only receive.
  uplinkMid: z.string().min(1).max(32).nullable().default(null),
  description: z.object({
    type: z.literal('offer'),
    sdp: z
      .string()
      .min(1)
      .max(64 * 1024),
  }),
})
export type MediaRequest = z.infer<typeof mediaRequestSchema>
export type MediaOffer = z.infer<typeof mediaOfferSchema>
