import { z } from 'zod'
import { nicknameSchema } from './nickname.ts'

export const ASIA_SERVERS = [
  'ariel',
  'azphel',
  'beritra',
  'ereshkigal',
  'fregion',
  'hadala',
  'hithanya',
  'israphel',
  'kaisinel',
  'lumiel',
  'marchutan',
  'meslamtaeda',
  'nania',
  'nemon',
  'nezekan',
  'siel',
  'triniel',
  'vaizel',
  'yustiel',
  'zikel',
] as const

export const characterRequestSchema = z.object({
  nickname: nicknameSchema,
  server: z.enum(ASIA_SERVERS),
})
export const characterProfileSchema = characterRequestSchema.extend({
  region: z.literal('as'),
  profileUrl: z.url(),
  description: z.string(),
})
export type CharacterProfile = z.infer<typeof characterProfileSchema>
export const roomNameSchema = nicknameSchema
export const DEFAULT_ROOM_ID = '00000000-0000-4000-8000-000000000001'
export const roomNumberSchema = z.number().int().positive().max(2_147_483_647)
export const roomNumberParameterSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(roomNumberSchema)
export const roomAdmissionSchema = z.object({
  server: z.enum(ASIA_SERVERS),
  allowedIds: z.array(nicknameSchema).max(200).default([]),
})
export const roomInstallSchema = roomAdmissionSchema.extend({ name: roomNameSchema })
export const roomCreationSchema = z.object({
  voiceChannelId: z.string().regex(/^[1-9][0-9]{16,19}$/),
})
export interface LobbyRoom {
  id: string
  number: number
  name: string
  memberCount: number
  stopped: boolean
  server: string
  restricted: boolean
}
export interface RoomDirectory {
  rooms: LobbyRoom[]
  available: boolean
  creationAvailable: boolean
}
