import type { ListenerSnapshot, PlayerEvent, PlayerMessage } from '@babel/contracts'
import { SubtitleView } from '~/utils/subtitle-view'

/** Times receipt to the frame that paints the subtitle. Hidden pages do not
 * paint, so they report the DOM update and say so; PiP-only viewing is hidden. */
function measureRender(probe: string, report: (message: PlayerMessage) => void) {
  const receivedAt = performance.now()
  void nextTick(() => {
    const visible = document.visibilityState === 'visible'
    const done = () =>
      report({
        type: 'subtitle-displayed',
        probe,
        renderDelayMs: Math.min(60_000, Math.max(0, performance.now() - receivedAt)),
        visible,
      })
    if (visible) {
      requestAnimationFrame(done)
    } else {
      done()
    }
  })
}

export function usePlayerSubtitles(
  session: Ref<ListenerSnapshot | null>,
  connectionState: Ref<string>,
  changing: Ref<boolean>,
  report: (message: PlayerMessage) => void,
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
      const probe = event.probe
      if (
        probe &&
        event.event.type === 'subtitle' &&
        presentation.value.items.includes(event.event.value)
      ) {
        measureRender(probe, report)
      }
    },
  }
}
