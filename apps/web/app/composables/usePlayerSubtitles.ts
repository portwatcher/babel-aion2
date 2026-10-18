import type { ListenerSnapshot, PlayerEvent } from '@babel/contracts'
import { SubtitleView } from '~/utils/subtitle-view'

export function usePlayerSubtitles(
  session: Ref<ListenerSnapshot | null>,
  connectionState: Ref<string>,
  changing: Ref<boolean>,
) {
  const view = new SubtitleView()
  const presentation = shallowRef(view.reset())
  function clear() {
    presentation.value = view.reset()
  }
  watch(
    () =>
      JSON.stringify([
        session.value?.sessionId,
        session.value?.nicknameGeneration,
        session.value?.subscriptionVersion,
        session.value?.state,
        session.value?.outputLanguage,
        connectionState.value,
        changing.value,
      ]),
    clear,
    { flush: 'sync' },
  )
  return {
    presentation,
    clear,
    receive(event: Extract<PlayerEvent, { type: 'subtitles' }>) {
      const current = session.value
      if (
        !current ||
        current.state !== 'ACTIVE' ||
        connectionState.value !== 'connected' ||
        changing.value ||
        event.subscriptionVersion !== current.subscriptionVersion ||
        event.outputLanguage !== current.outputLanguage
      ) {
        return
      }
      const value = event.event.type === 'subtitle' ? event.event.value : event.event
      if (
        value.roomId !== current.roomId ||
        value.outputLanguage !== current.outputLanguage
      ) {
        return
      }
      presentation.value = view.accept(event.event)
    },
  }
}
