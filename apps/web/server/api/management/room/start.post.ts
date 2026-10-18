import { administratorUserId } from '@babel/auth'
import { roomStopSchema } from '@babel/contracts'
import { startRoom } from '@babel/database/room-settings'
import { requireAdministratorSession } from '../../../utils/auth'
import {
  readRoomConfigurationBody,
  roomConfigurationOperation,
  roomCredentialCipher,
} from '../../../utils/management-configuration'
import { useListenerRoom } from '../../../utils/room-configuration'
import { voiceSourceStatus } from '../../../utils/media-control'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const input = roomStopSchema.safeParse(await readRoomConfigurationBody(event))
  if (!input.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid room version' })
  }
  const { database, roomId } = await useListenerRoom(event)
  if (!(await voiceSourceStatus(roomId))) {
    throw createError({ statusCode: 503, statusMessage: 'Voice worker unavailable' })
  }
  return roomConfigurationOperation(() =>
    startRoom(
      database,
      roomId,
      input.data.expectedVersion,
      administratorUserId(identity),
      roomCredentialCipher(event),
    ),
  )
})
