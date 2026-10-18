import { z } from 'zod'
import { publicListenerSchema } from './listeners.ts'

const discordId = z.string().regex(/^[1-9][0-9]{16,19}$/)
const configurationVersion = z.number().int().positive().max(2_147_483_647)
const roomName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u)
const commanders = z
  .array(discordId)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length)
export const discordCaptureModeSchema = z.enum(['SELECTED_USERS', 'ALL_CHANNEL'])
export type DiscordCaptureMode = z.infer<typeof discordCaptureModeSchema>

export const roomUpdateSchema = z
  .object({
    expectedVersion: configurationVersion,
    name: roomName,
    guildId: discordId.nullable(),
    voiceChannelId: discordId.nullable(),
    captureMode: discordCaptureModeSchema,
    commanderIds: commanders,
    credential: z
      .string()
      .min(20)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
    removeCredential: z.boolean().default(false),
  })
  .strict()
  .refine((input) => !(input.credential && input.removeCredential))
  .refine((input) => Boolean(input.guildId) === Boolean(input.voiceChannelId))
  .refine((input) => input.guildId !== null || input.commanderIds.length === 0)

export const roomStopSchema = z
  .object({ expectedVersion: configurationVersion })
  .strict()
export const managementRoomSchema = z.object({
  id: z.uuid(),
  name: roomName,
  stopped: z.boolean(),
  sourceGeneration: z.number().int().nonnegative(),
  version: configurationVersion,
  guildId: discordId.nullable(),
  voiceChannelId: discordId.nullable(),
  captureMode: discordCaptureModeSchema,
  commanderIds: commanders,
  credentialConfigured: z.boolean(),
  sourceConfigured: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const managementListenerSchema = publicListenerSchema.extend({
  nicknameGeneration: z.number().int().positive(),
})

export type RoomUpdate = z.infer<typeof roomUpdateSchema>
export type ManagementRoom = z.infer<typeof managementRoomSchema>
export const managementRoomResponseSchema = z.object({
  room: managementRoomSchema,
  credentialProtectionReady: z.boolean(),
})
