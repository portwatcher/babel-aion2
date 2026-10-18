import { z } from 'zod'

export const voiceSourceStateSchema = z.enum([
  'STOPPED',
  'STOPPING',
  'CONNECTING',
  'LISTENING',
  'UNAVAILABLE',
])
export const voiceSourceStatusSchema = z.object({
  roomId: z.uuid(),
  sourceGeneration: z.number().int().nonnegative(),
  state: voiceSourceStateSchema,
  reason: z.enum(['CONFIGURATION', 'OWNERSHIP', 'DISCORD', 'STORAGE']).nullable(),
  speakers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      receivedFrames: z.number().int().nonnegative(),
    }),
  ),
})
export const voiceSourceRequestSchema = z.object({ roomId: z.uuid() }).strict()
export type VoiceSourceStatus = z.infer<typeof voiceSourceStatusSchema>
