import {
  playerEventSchema,
  type PlayerEvent,
  type PlayerMessage,
} from '@babel/contracts'
import type { SavedListener } from '~/utils/listener-client'

export function usePlayerConnection(
  onEvent: (event: PlayerEvent) => void,
  onInvalid: () => void,
) {
  const state = ref<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle')
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let attempts = 0
  let access: SavedListener | null = null

  function stop() {
    generation += 1
    clearTimeout(retry)
    retry = undefined
    socket?.close()
    socket = undefined
    access = null
    state.value = 'idle'
  }

  function open() {
    if (!access) {
      return
    }
    const currentGeneration = ++generation
    const credential = access
    const url = new URL('/api/player/ws', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(url)
    socket = current
    current.onopen = () => {
      if (currentGeneration !== generation) {
        current.close()
        return
      }
      current.send(
        JSON.stringify({
          type: 'authenticate',
          sessionId: credential.sessionId,
          credential: credential.credential,
        }),
      )
    }
    current.onmessage = (event) => {
      if (currentGeneration !== generation) {
        return
      }
      let input: unknown
      try {
        input = JSON.parse(String(event.data))
      } catch {
        current.close()
        return
      }
      const parsed = playerEventSchema.safeParse(input)
      if (!parsed.success) {
        current.close()
        return
      }
      if (parsed.data.type === 'ping') {
        current.send(JSON.stringify({ type: 'pong', nonce: parsed.data.nonce }))
        return
      }
      if (parsed.data.type === 'session') {
        if (
          parsed.data.session.sessionId !== credential.sessionId ||
          parsed.data.session.nicknameGeneration !== credential.nicknameGeneration
        ) {
          stop()
          onInvalid()
          return
        }
        state.value = 'connected'
        attempts = 0
      }
      if (parsed.data.type === 'error' && parsed.data.code === 'INVALID_CREDENTIAL') {
        stop()
        onInvalid()
        return
      }
      onEvent(parsed.data)
    }
    current.onclose = (event) => {
      if (currentGeneration !== generation || !access) {
        return
      }
      if (event.code === 4401 || event.code === 4400) {
        stop()
        onInvalid()
        return
      }
      state.value = 'reconnecting'
      // Jitter spreads reconnects when many players lose the server together.
      const backoff = Math.min(15_000, 1_000 * 2 ** Math.min(attempts++, 4))
      retry = setTimeout(open, backoff / 2 + Math.random() * (backoff / 2))
    }
    current.onerror = () => {
      /* onclose owns recovery of the same session. */
    }
  }

  function send(message: PlayerMessage) {
    if (socket?.readyState === WebSocket.OPEN && state.value === 'connected') {
      socket.send(JSON.stringify(message))
    }
  }

  function connect(saved: SavedListener) {
    stop()
    access = saved
    attempts = 0
    state.value = 'connecting'
    open()
  }

  onBeforeUnmount(stop)
  return { state, connect, stop, send }
}
