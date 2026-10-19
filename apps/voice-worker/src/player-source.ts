import type { VoiceSourceStatus } from '@babel/contracts'

/** Receives decoded host PCM from the media peer of a PLAYER room's host. */
export interface PlayerUplink {
  readonly hostId: string
  receive(id: string, displayName: string, pcm: Buffer): void
  remove(id: string): void
}

/**
 * Audio input of a PLAYER room. Its only speaker is the host character's own
 * browser peer; there is no Discord connection, so it is ready once opened.
 */
export class PlayerSource implements PlayerUplink {
  private readonly speakers = new Map<string, VoiceSourceStatus['speakers'][number]>()
  private closed = false

  constructor(
    readonly hostId: string,
    private readonly frame: (id: string, pcm: Buffer, displayName: string) => void,
    private readonly removed: (id: string) => void,
  ) {}

  ready() {
    return !this.closed
  }

  status() {
    return [...this.speakers.values()].map((speaker) => ({ ...speaker }))
  }

  receive(id: string, displayName: string, pcm: Buffer) {
    if (this.closed) {
      return
    }
    const speaker = this.speakers.get(id) ?? { id, displayName, receivedFrames: 0 }
    speaker.receivedFrames += 1
    this.speakers.set(id, speaker)
    this.frame(id, pcm, displayName)
  }

  remove(id: string) {
    if (this.speakers.delete(id)) {
      this.removed(id)
    }
  }

  async close() {
    this.closed = true
    for (const id of [...this.speakers.keys()]) {
      this.remove(id)
    }
  }
}
