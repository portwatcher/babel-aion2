import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  useListeners,
} from '../../../utils/listeners'

export default defineEventHandler(async (event) => {
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  return listenerOperation(() => useListeners(event).restore(id, credential))
})
