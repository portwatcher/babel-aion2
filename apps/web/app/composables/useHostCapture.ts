/** Value of the "computer audio" choice; other choices are `device:<id>`. */
export const COMPUTER_AUDIO = 'display'
const SAVED_INPUT = 'babel-host-input'

// Chromium screen-capture hints not yet in the DOM library typings.
interface ComputerAudioOptions extends DisplayMediaStreamOptions {
  systemAudio: 'include'
  selfBrowserSurface: 'exclude'
}

export type HostCaptureState = 'off' | 'idle' | 'live' | 'blocked' | 'silent'

function savedInput() {
  try {
    return localStorage.getItem(SAVED_INPUT)
  } catch {
    return null
  }
}

function saveInput(value: string) {
  try {
    localStorage.setItem(SAVED_INPUT, value)
  } catch {
    /* The choice still applies to this page. */
  }
}

/**
 * The input a player-source room host publishes. The stream belongs to the
 * page rather than one peer, so media reconnects reuse it without asking
 * again; a computer-audio share cannot restart without a user gesture.
 */
export function useHostCapture() {
  // 'off' for everyone except the host of a player-source room.
  const state = ref<HostCaptureState>('off')
  const muted = ref(false)
  const selected = ref<string | null>(null)
  const devices = ref<{ value: string; label: string }[]>([])
  let stream: MediaStream | null = null
  let sender: RTCRtpSender | null = null
  let request = 0

  function track() {
    return stream?.getAudioTracks()[0] ?? null
  }

  async function send() {
    const current = sender
    try {
      await current?.replaceTrack(track())
    } catch {
      /* A closed peer is replaced by the next negotiation. */
    }
  }

  async function refreshDevices() {
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audioinput',
      )
      // Before any permission, browsers hide IDs and labels; offer one default.
      const listed = new Map<string, string>()
      for (const device of inputs) {
        listed.set(`device:${device.deviceId}`, device.label)
      }
      devices.value = [...listed].map(([value, label]) => ({ value, label }))
    } catch {
      devices.value = []
    }
  }

  async function acquire(value: string) {
    if (value === COMPUTER_AUDIO) {
      const options: ComputerAudioOptions = {
        video: true,
        // Game and system audio must not pass through voice processing.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        // Offer whole-screen system audio and leave this tab out of the picker.
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      }
      const shared = await navigator.mediaDevices.getDisplayMedia(options)
      for (const video of shared.getVideoTracks()) {
        video.stop()
      }
      return shared
    }
    const deviceId = value.slice('device:'.length)
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
  }

  /** Switches the published input. Call from a user action for computer audio. */
  async function select(value: string) {
    const current = ++request
    selected.value = value
    let next: MediaStream
    try {
      next = await acquire(value)
    } catch {
      if (current === request) {
        state.value = 'blocked'
      }
      return
    }
    if (current !== request || state.value === 'off') {
      for (const item of next.getTracks()) {
        item.stop()
      }
      return
    }
    const previous = stream
    stream = next
    const audio = track()
    if (audio) {
      audio.enabled = !muted.value
      audio.addEventListener('ended', () => {
        if (stream === next) {
          stream = null
          state.value = 'idle'
          void send()
        }
      })
    }
    state.value = audio ? 'live' : 'silent'
    await send()
    for (const item of previous?.getTracks() ?? []) {
      item.stop()
    }
    if (value !== COMPUTER_AUDIO) {
      await refreshDevices()
    }
    saveInput(value)
  }

  /** Binds the host uplink of a new negotiation; call before creating the answer. */
  function attach(transceiver: RTCRtpTransceiver) {
    // Always offer to send, so later input changes need no renegotiation.
    transceiver.direction = 'sendonly'
    sender = transceiver.sender
    if (state.value === 'off') {
      state.value = 'idle'
      void refreshDevices()
      const saved = savedInput()
      if (saved?.startsWith('device:')) {
        void select(saved)
      }
    }
    void send()
  }

  function detach() {
    sender = null
  }

  function toggleMute() {
    muted.value = !muted.value
    const audio = track()
    if (audio) {
      audio.enabled = !muted.value
    }
  }

  function stop() {
    request += 1
    sender = null
    for (const item of stream?.getTracks() ?? []) {
      item.stop()
    }
    stream = null
    selected.value = null
    state.value = 'off'
  }

  return { state, muted, selected, devices, select, attach, detach, toggleMute, stop }
}
