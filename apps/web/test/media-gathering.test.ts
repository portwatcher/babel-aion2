import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gatherMediaCandidates } from '../app/utils/media-gathering.ts'

class GatheringPeer extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'gathering'
  localDescription = { sdp: 'v=0\r\n' }

  candidate() {
    this.localDescription.sdp +=
      'a=candidate:1 1 udp 16777215 192.0.2.1 50000 typ relay\r\n'
  }

  complete() {
    this.iceGatheringState = 'complete'
    this.dispatchEvent(new Event('icegatheringstatechange'))
  }
}

for (const complete of [true, false]) {
  test(`a collected candidate can be submitted when gathering ${complete ? 'completes' : 'reaches its deadline'}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const peer = new GatheringPeer()
    const ready = gatherMediaCandidates(peer, new AbortController().signal)
    void ready.catch(() => {})
    peer.candidate()
    if (complete) {
      peer.complete()
    } else {
      // One relay is ready while another discovery server never responds.
      t.mock.timers.tick(10_000)
    }
    await assert.doesNotReject(ready)
  })
}

test('a deadline without candidates fails, and cancellation still wins after a candidate arrives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const empty = gatherMediaCandidates(new GatheringPeer(), new AbortController().signal)
  void empty.catch(() => {})
  t.mock.timers.tick(10_000)
  await assert.rejects(empty, /timeout/)

  const peer = new GatheringPeer()
  const controller = new AbortController()
  const cancelled = gatherMediaCandidates(peer, controller.signal)
  peer.candidate()
  controller.abort()
  peer.complete()
  await assert.rejects(cancelled, /cancelled/)
})
