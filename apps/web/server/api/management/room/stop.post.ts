import { administratorUserId } from '@babel/auth'
import { roomStopSchema } from '@babel/contracts'
import { stopRoom } from '@babel/database/room-settings'
import { requireAdministratorSession } from '../../../utils/auth'
import {
  readRoomConfigurationBody,
  roomConfigurationOperation,
} from '../../../utils/management-configuration'
import { useListenerRoom } from '../../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const input = roomStopSchema.safeParse(await readRoomConfigurationBody(event))
  if (!input.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid room version' })
  }
  return roomConfigurationOperation(async () => {
    const { database, roomId } = await useListenerRoom(event)
    return stopRoom(
      database,
      roomId,
      input.data.expectedVersion,
      administratorUserId(identity),
    )
  })
})
