import type {
  ListenerSnapshot,
  PlayerEvent,
  SubtitleHistoryItem,
} from '@babel/contracts'
import { PlayerApiError, requestSubtitleHistory } from '~/utils/listener-client'
import { SubtitleHistoryView } from '~/utils/subtitle-history'

export interface SubtitleHistoryState {
  items: SubtitleHistoryItem[]
  loading: boolean
  error: boolean
}

export function useSubtitleHistory(
  session: Ref<ListenerSnapshot | null>,
  credential: Ref<string | null>,
  connectionState: Ref<string>,
  changingLanguage: Ref<boolean>,
) {
  const view = new SubtitleHistoryView()
  const items = shallowRef<SubtitleHistoryItem[]>([])
  const loading = ref(false)
  const error = ref(false)
  let epoch = 0
  let controller: AbortController | null = null
  let disposed = false
  let pruneTimer: ReturnType<typeof setInterval> | undefined

  function abortPending() {
    controller?.abort()
    controller = null
  }

  function clear() {
    epoch += 1
    abortPending()
    items.value = view.reset()
    loading.value = false
    error.value = false
  }

  async function refresh() {
    const current = session.value
    const token = credential.value
    if (
      !import.meta.client ||
      disposed ||
      !current ||
      !token ||
      current.state !== 'ACTIVE' ||
      !current.outputLanguage ||
      changingLanguage.value
    ) {
      return
    }
    abortPending()
    const requestEpoch = ++epoch
    const expectedRoomId = current.roomId
    const expectedLanguage = current.outputLanguage
    const expectedSubscription = current.subscriptionVersion
    const cancellation = new AbortController()
    controller = cancellation
    loading.value = true
    error.value = false
    try {
      const history = await requestSubtitleHistory(
        current.sessionId,
        token,
        cancellation.signal,
      )
      if (disposed || requestEpoch !== epoch) {
        return
      }
      const latest = session.value
      if (
        !latest ||
        latest.state !== 'ACTIVE' ||
        latest.roomId !== expectedRoomId ||
        latest.outputLanguage !== expectedLanguage ||
        latest.subscriptionVersion !== expectedSubscription ||
        history.roomId !== expectedRoomId ||
        (history.outputLanguage !== null && history.outputLanguage !== expectedLanguage)
      ) {
        return
      }
      items.value = view.hydrate(history)
      error.value = false
    } catch (failure) {
      if (disposed || requestEpoch !== epoch || cancellation.signal.aborted) {
        return
      }
      if (
        failure instanceof PlayerApiError &&
        [401, 409, 410].includes(failure.status)
      ) {
        items.value = view.reset()
        error.value = false
        return
      }
      error.value = true
    } finally {
      if (controller === cancellation) {
        controller = null
      }
      if (!disposed && requestEpoch === epoch) {
        loading.value = false
      }
    }
  }

  watch(
    () =>
      JSON.stringify([
        session.value?.sessionId,
        session.value?.nicknameGeneration,
        session.value?.subscriptionVersion,
        session.value?.state,
        session.value?.outputLanguage,
        Boolean(credential.value),
        changingLanguage.value,
      ]),
    () => {
      clear()
      if (
        session.value?.state === 'ACTIVE' &&
        session.value.outputLanguage &&
        credential.value &&
        !changingLanguage.value
      ) {
        void refresh()
      }
    },
    { flush: 'sync', immediate: true },
  )

  watch(connectionState, (next, previous) => {
    if (
      next === 'connected' &&
      previous === 'reconnecting' &&
      session.value?.state === 'ACTIVE' &&
      session.value.outputLanguage &&
      credential.value &&
      !changingLanguage.value
    ) {
      void refresh()
    }
  })

  onMounted(() => {
    pruneTimer = setInterval(() => {
      const pruned = view.prune()
      if (pruned.changed) {
        items.value = pruned.items
      }
    }, 5_000)
  })

  onBeforeUnmount(() => {
    disposed = true
    epoch += 1
    abortPending()
    clearInterval(pruneTimer)
  })

  return {
    state: computed<SubtitleHistoryState>(() => ({
      items: items.value,
      loading: loading.value,
      error: error.value,
    })),
    clear,
    refresh,
    receive(event: Extract<PlayerEvent, { type: 'subtitles' }>) {
      const current = session.value
      if (
        !current ||
        current.state !== 'ACTIVE' ||
        connectionState.value !== 'connected' ||
        changingLanguage.value ||
        event.subscriptionVersion !== current.subscriptionVersion ||
        event.outputLanguage !== current.outputLanguage ||
        event.event.type !== 'subtitle'
      ) {
        return
      }
      const value = event.event.value
      if (
        value.roomId !== current.roomId ||
        value.outputLanguage !== current.outputLanguage
      ) {
        return
      }
      items.value = view.accept(value)
    },
  }
}
