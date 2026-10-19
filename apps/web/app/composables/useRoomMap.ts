import type { InterfaceMessageKey } from '~/locales'
import {
  mapStrokeSchema,
  type ListenerSnapshot,
  type MapStroke,
  type MapStrokeInput,
} from '@babel/contracts'

class RoomMapError extends Error {
  constructor(readonly key: 'mapLimit' | 'mapSessionEnded' | 'mapSyncFailed') {
    super(key)
  }
}

export function useRoomMap(
  roomId: string,
  session: Ref<ListenerSnapshot | null>,
  credential: Ref<string | null>,
) {
  const { t } = useInterfaceLocale()
  const strokes = shallowRef<MapStroke[]>([])
  const current = ref(false)
  const error = ref<InterfaceMessageKey | ''>('')
  const busy = ref(false)
  const denied = ref(false)
  const enabled = computed(() =>
    Boolean(session.value && credential.value && !denied.value),
  )
  const path = `/api/player/rooms/${roomId}/map`
  let disposed = false
  let version = 0
  let reading = false
  let timer: ReturnType<typeof setInterval> | undefined
  const controller = new AbortController()

  async function request(method = 'GET', suffix = '', body?: MapStrokeInput) {
    if (!session.value || !credential.value) {
      throw new Error('Session required')
    }
    const response = await fetch(`${path}${suffix}`, {
      method,
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      headers: {
        authorization: `Bearer ${credential.value}`,
        'x-listener-session': session.value.sessionId,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if ([401, 403].includes(response.status)) {
      denied.value = true
    }
    if (!response.ok) {
      throw new RoomMapError(
        response.status === 429
          ? 'mapLimit'
          : denied.value
            ? 'mapSessionEnded'
            : 'mapSyncFailed',
      )
    }
    return response.json() as Promise<unknown>
  }
  async function refresh() {
    if (!enabled.value || reading || busy.value || disposed) {
      return
    }
    reading = true
    const requestVersion = version
    try {
      const result = await request()
      const parsed = mapStrokeSchema
        .array()
        .parse(
          result && typeof result === 'object' && 'strokes' in result
            ? result.strokes
            : null,
        )
      if (!disposed && requestVersion === version) {
        strokes.value = parsed
        current.value = true
        error.value = ''
      }
    } catch (failure) {
      if (!disposed && requestVersion === version) {
        current.value = false
        error.value = failure instanceof RoomMapError ? failure.key : 'mapSyncFailed'
      }
    } finally {
      reading = false
    }
  }
  async function save(stroke: MapStrokeInput) {
    busy.value = true
    version += 1
    error.value = ''
    const requestVersion = version
    try {
      await request('POST', '', stroke)
      if (disposed || requestVersion !== version || !session.value) {
        return false
      }
      strokes.value = [
        ...strokes.value.filter((item) => item.id !== stroke.id),
        {
          ...stroke,
          sessionId: session.value.sessionId,
          nickname: session.value.nickname,
          createdAt: new Date().toISOString(),
        },
      ]
      return true
    } catch (failure) {
      if (!disposed) {
        error.value = failure instanceof RoomMapError ? failure.key : 'mapSaveFailed'
      }
      return false
    } finally {
      busy.value = false
    }
  }
  async function remove(id: string) {
    busy.value = true
    version += 1
    error.value = ''
    const requestVersion = version
    try {
      await request('DELETE', `/${id}`)
      if (!disposed && requestVersion === version) {
        strokes.value = strokes.value.filter((stroke) => stroke.id !== id)
      }
    } catch (failure) {
      if (!disposed) {
        error.value = failure instanceof RoomMapError ? failure.key : 'mapDeleteFailed'
      }
    } finally {
      busy.value = false
    }
  }
  watch(
    () => session.value?.sessionId,
    () => {
      version += 1
      strokes.value = []
      current.value = false
      denied.value = false
      void refresh()
    },
  )
  onMounted(() => {
    void refresh()
    timer = setInterval(() => void refresh(), 2_000)
  })
  onBeforeUnmount(() => {
    disposed = true
    version += 1
    clearInterval(timer)
    controller.abort()
  })
  return {
    strokes,
    current,
    busy,
    error: computed(() => (error.value ? t(error.value) : '')),
    enabled,
    refresh,
    save,
    remove,
  }
}
