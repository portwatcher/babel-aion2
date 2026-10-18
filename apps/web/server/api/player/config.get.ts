import { publicRoomConfiguration } from '../../utils/room-configuration'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return publicRoomConfiguration(event)
})
