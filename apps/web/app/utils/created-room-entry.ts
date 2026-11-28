import { publicRoomConfigurationSchema, selectOutputLanguage } from '@babel/contracts'
import {
  createPendingEntry,
  listenerRequest,
  loadListener,
  loadPendingEntry,
  PlayerApiError,
  savedLanguage,
  saveListener,
  savePendingEntry,
} from './listener-client'

/** Finish room creation through the same verified admission as other members. */
export async function enterCreatedRoom(roomNumber: number, hostId: string) {
  const destination = String(roomNumber)
  if (loadListener(destination)) {
    return
  }
  const response = await fetch(`/api/player/rooms/${destination}/config`)
  if (!response.ok) {
    throw new PlayerApiError(response.status)
  }
  const configuration = publicRoomConfigurationSchema.parse(await response.json())
  const outputLanguage = selectOutputLanguage(
    configuration.outputLanguages,
    navigator.languages?.length ? navigator.languages : [navigator.language],
    savedLanguage(),
    configuration.defaultOutputLanguage,
  )
  let pending = loadPendingEntry(destination)
  if (!pending || pending.request.nickname !== hostId) {
    pending = createPendingEntry(hostId, outputLanguage)
    savePendingEntry(pending, destination)
  }
  const session = await listenerRequest(
    `/api/player/rooms/${destination}/sessions`,
    pending.credential,
    'POST',
    pending.request,
  )
  saveListener(
    {
      sessionId: session.sessionId,
      nicknameGeneration: session.nicknameGeneration,
      credential: pending.credential,
      leaving: false,
      mediaAttempt: 0,
    },
    destination,
  )
  savePendingEntry(null, destination)
}
