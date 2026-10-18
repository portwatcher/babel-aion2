import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../../../utils/listeners'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  return listenerOperation(() => useListeners(event).heartbeat(id, credential))
})
