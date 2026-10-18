import { publicListenerSchema, type PublicListener } from '@babel/contracts'

export function usePlayerList(connectionState: Ref<string>) {
  const players = shallowRef<PublicListener[]>([])
  const current = ref(false)
  let version = 0
  let reading = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined

  function accept(next: PublicListener[]) {
    version += 1
    players.value = next
    current.value = true
  }

  async function refresh() {
    if (reading || disposed || connectionState.value === 'connected') {
      return
    }
    const requestVersion = version
    reading = true
    try {
      const response = await fetch('/api/player/players', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        throw new Error('List unavailable')
      }
      const result: unknown = await response.json()
      const parsed = publicListenerSchema
        .array()
        .parse(
          result && typeof result === 'object' && 'players' in result
            ? result.players
            : null,
        )
      // An older HTTP response cannot overwrite a more recent socket snapshot.
      if (!disposed && requestVersion === version) {
        accept(parsed)
      }
    } catch {
      if (!disposed && requestVersion === version) {
        current.value = false
      }
    } finally {
      reading = false
    }
  }

  watch(connectionState, (state) => {
    if (state !== 'connected') {
      current.value = false
      void refresh()
    }
  })
  onMounted(() => {
    void refresh()
    timer = setInterval(() => void refresh(), 5_000)
  })
  onBeforeUnmount(() => {
    disposed = true
    clearInterval(timer)
  })
  return { players, current, accept }
}
