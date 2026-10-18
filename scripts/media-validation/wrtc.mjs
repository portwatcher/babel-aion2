import wrtc from '@roamhq/wrtc'

// Natural process termination is part of this check. Do not add process.exit(),
// force a GC, or equate reaching track.stop() with successful native cleanup.
const source = new wrtc.nonstandard.RTCAudioSource()
const track = source.createTrack()
track.stop()
process.send?.({ stoppedTrack: true })
process.disconnect?.()
