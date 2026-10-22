interface CandidatePeer extends EventTarget {
  readonly iceGatheringState: RTCIceGatheringState
  readonly localDescription: Pick<RTCSessionDescription, 'sdp'> | null
}

export async function gatherMediaCandidates(peer: CandidatePeer, signal: AbortSignal) {
  if (peer.iceGatheringState === 'complete') {
    return
  }
  await new Promise<void>((resolve, reject) => {
    // One unresponsive discovery server must not discard candidates already
    // collected under the peer's configured ICE transport policy.
    const deadline = setTimeout(
      () =>
        finish(
          /^a=candidate:/m.test(peer.localDescription?.sdp ?? '')
            ? undefined
            : new Error('Media gathering timeout'),
        ),
      10_000,
    )
    const abort = () => finish(new Error('Media connection cancelled'))
    const changed = () => {
      if (peer.iceGatheringState === 'complete') {
        finish()
      }
    }
    function finish(error?: Error) {
      clearTimeout(deadline)
      peer.removeEventListener('icegatheringstatechange', changed)
      signal.removeEventListener('abort', abort)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    peer.addEventListener('icegatheringstatechange', changed)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
    } else {
      changed()
    }
  })
}
