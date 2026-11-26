import { SUBTITLE_HISTORY_WINDOW_MS } from '@babel/contracts'
import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  useListeners,
} from '../../../../utils/listeners'
import { subtitleHistory } from '../../../../utils/media-control'

export default defineEventHandler(async (event) => {
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  return listenerOperation(async () => {
    const session = await useListeners(event).restore(id, credential)
    if (session.state !== 'ACTIVE') {
      throw createError({
        statusCode: session.state === 'JOINING' ? 409 : 410,
        statusMessage: 'Listener is not authorized for subtitle history',
      })
    }
    if (!session.outputLanguage) {
      return {
        roomId: session.roomId,
        outputLanguage: null,
        windowMs: SUBTITLE_HISTORY_WINDOW_MS,
        availableLanguages: [],
        items: [],
        serverNow: new Date().toISOString(),
      }
    }
    const history = await subtitleHistory(session, credential)
    if (history.roomId !== session.roomId) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Subtitle history unavailable',
      })
    }
    return history
  })
})
