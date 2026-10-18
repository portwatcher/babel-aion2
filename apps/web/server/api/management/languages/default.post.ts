import { languageDefaultSchema } from '@babel/contracts'
import { languageBody, languageOperation } from '../../../utils/output-languages'
import { useListenerRoom } from '../../../utils/room-configuration'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) => {
    const input = await languageBody(event, languageDefaultSchema)
    const { roomId } = await useListenerRoom(event)
    return service.default(roomId, input.code, input.expectedCatalogVersion, actor)
  }),
)
