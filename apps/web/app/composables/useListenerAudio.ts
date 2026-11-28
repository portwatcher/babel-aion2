import { gatherMediaCandidates } from '~/utils/media-gathering'
import type { ListenerReference } from '@babel/contracts'
import {
  PlayerApiError,
  requestListenerMedia,
  type SavedListener,
} from '~/utils/listener-client'

interface AudioConnection {
  id: string
  listener: SavedListener
  peer: RTCPeerConnection
  abort: AbortController
  renewal: ReturnType<typeof setTimeout> | undefined
}

export function useListenerAudio(
  nextAttempt: (reference: ListenerReference) => number,
) {
  const state = ref<
    'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable'
  >('idle')
  const blocked = ref(false)
  const muted = ref(false)
  // Only a player-source room host publishes; everyone else stays 'off'.
  const capture = useHostCapture()
  let connection: AudioConnection | null = null
  let desired: SavedListener | null = null
  let sound: HTMLAudioElement | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function clearConnection() {
    const previous = connection
    connection = null
    if (previous) {
      clearTimeout(previous.renewal)
      previous.abort.abort()
      previous.peer.close()
      capture.detach()
      void requestListenerMedia(previous.listener, {
        operation: 'close',
        connectionId: previous.id,
      }).catch(() => {})
    }
    if (sound) {
      sound.pause()
      sound.srcObject = null
    }
    blocked.value = false
  }

  function stop() {
    desired = null
    clearTimeout(retry)
    retry = undefined
    clearConnection()
    capture.stop()
    state.value = 'idle'
  }

  async function play() {
    const active = connection
    if (!sound || !active) {
      return
    }
    try {
      await sound.play()
      if (connection === active) {
        blocked.value = false
      }
    } catch {
      if (connection === active) {
        blocked.value = true
      }
    }
  }

  function schedule() {
    if (!desired || disposed || retry) {
      return
    }
    state.value = 'reconnecting'
    retry = setTimeout(() => {
      retry = undefined
      if (desired && !disposed) {
        void begin(desired)
      }
    }, 1_500)
  }

  async function begin(listener: SavedListener) {
    clearConnection()
    if (disposed || !desired || typeof RTCPeerConnection === 'undefined') {
      state.value = 'unavailable'
      return
    }
    const active: AudioConnection = {
      id: crypto.randomUUID(),
      listener,
      peer: new RTCPeerConnection({ iceServers: [] }),
      abort: new AbortController(),
      renewal: undefined,
    }
    connection = active
    state.value = 'connecting'
    let stage = 'offer'
    if (!sound) {
      sound = new Audio()
      sound.muted = muted.value
    }
    active.peer.ontrack = (event) => {
      if (connection !== active || !sound) {
        return
      }
      sound.srcObject = new MediaStream([event.track])
      void play()
    }
    active.peer.onconnectionstatechange = () => {
      if (connection !== active) {
        return
      }
      if (active.peer.connectionState === 'connected') {
        clearTimeout(retry)
        retry = undefined
        state.value = 'connected'
      } else if (
        ['disconnected', 'failed', 'closed'].includes(active.peer.connectionState)
      ) {
        schedule()
      }
    }
    try {
      const offer = await requestListenerMedia(
        listener,
        {
          operation: 'offer',
          connectionId: active.id,
          attempt: nextAttempt(listener),
        },
        active.abort.signal,
      )
      if (connection !== active) {
        return
      }
      if (!offer || offer.connectionId !== active.id) {
        throw new Error('Invalid media offer')
      }
      stage = 'configuration'
      active.peer.setConfiguration({
        iceServers: offer.ice.servers,
        iceTransportPolicy: offer.ice.policy,
      })
      if (offer.ice.renewAfterMs !== null) {
        active.renewal = setTimeout(() => {
          if (connection === active) {
            schedule()
          }
        }, offer.ice.renewAfterMs)
      }
      stage = 'description'
      await active.peer.setRemoteDescription(offer.description)
      if (offer.uplinkMid === null) {
        capture.stop()
      } else {
        const uplink = active.peer
          .getTransceivers()
          .find((candidate) => candidate.mid === offer.uplinkMid)
        if (!uplink) {
          throw new Error('Uplink transceiver unavailable')
        }
        capture.attach(uplink)
      }
      stage = 'answer'
      await active.peer.setLocalDescription(await active.peer.createAnswer())
      stage = 'gathering'
      await gatherMediaCandidates(active.peer, active.abort.signal)
      if (connection !== active) {
        return
      }
      const description = active.peer.localDescription
      if (!description || description.type !== 'answer') {
        throw new Error('Media answer unavailable')
      }
      stage = 'answer-delivery'
      await requestListenerMedia(
        listener,
        {
          operation: 'answer',
          connectionId: active.id,
          description: { type: 'answer', sdp: description.sdp },
        },
        active.abort.signal,
      )
    } catch (error) {
      if (connection !== active) {
        return
      }
      // Controlled diagnostics only: never log credentials, SDP or raw errors.
      console.warn('Babel audio negotiation failed', {
        stage,
        status: error instanceof PlayerApiError ? error.status : null,
      })
      clearConnection()
      if (error instanceof PlayerApiError && [401, 410].includes(error.status)) {
        desired = null
        state.value = 'unavailable'
      } else {
        schedule()
      }
    }
  }

  function connect(listener: SavedListener) {
    if (
      desired?.sessionId === listener.sessionId &&
      desired.nicknameGeneration === listener.nicknameGeneration
    ) {
      return
    }
    stop()
    desired = listener
    void begin(listener)
  }

  function toggleMute() {
    muted.value = !muted.value
    if (sound) {
      sound.muted = muted.value
    }
  }

  onMounted(() => window.addEventListener('pagehide', stop))
  onBeforeUnmount(() => {
    disposed = true
    window.removeEventListener('pagehide', stop)
    stop()
    sound = null
  })
  return {
    state,
    blocked,
    muted,
    capture,
    play,
    toggleMute,
    connect,
    stop,
  }
}
