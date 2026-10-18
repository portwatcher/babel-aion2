import { languageOperation } from '../../utils/output-languages'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler((event) =>
  languageOperation(event, async (service) => {
    const { roomId } = await useListenerRoom(event)
    return service.list(roomId, getQuery(event))
  }),
)
