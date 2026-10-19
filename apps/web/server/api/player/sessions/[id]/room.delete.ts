import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../../../utils/listeners'

// Only the room host's current session may close its community room.
export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  return listenerOperation(() => useListeners(event).closeRoom(id, credential))
})
