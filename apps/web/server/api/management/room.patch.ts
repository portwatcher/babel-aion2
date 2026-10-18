import { administratorUserId } from '@babel/auth'
import { roomUpdateSchema } from '@babel/contracts'
import { updateRoomSettings } from '@babel/database/room-settings'
import { requireAdministratorSession } from '../../utils/auth'
import {
  roomConfigurationOperation,
  roomCredentialCipher,
  readRoomConfigurationBody,
} from '../../utils/management-configuration'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const input = roomUpdateSchema.safeParse(await readRoomConfigurationBody(event))
  if (!input.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid room configuration' })
  }
  return roomConfigurationOperation(async () => {
    const { database, roomId } = await useListenerRoom(event)
    return updateRoomSettings(
      database,
      roomId,
      input.data,
      administratorUserId(identity),
      roomCredentialCipher(event),
    )
  })
})
