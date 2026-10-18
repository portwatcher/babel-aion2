import { readRoomSettings } from '@babel/database/room-settings'
import { requireAdministratorSession } from '../../utils/auth'
import {
  roomConfigurationOperation,
  roomCredentialCipher,
} from '../../utils/management-configuration'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  await requireAdministratorSession(event)
  return roomConfigurationOperation(async () => {
    const { database, roomId } = await useListenerRoom(event)
    return {
      room: await readRoomSettings(database, roomId),
      credentialProtectionReady: roomCredentialCipher(event) !== null,
    }
  })
})
