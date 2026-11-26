export const PCM_FRAME_BYTES = 960 * 2 * 2
const MAX_QUEUE_MS = 100

/** A copied 48 kHz stereo timeline, bounded in milliseconds rather than packets. */
export class PcmTimeline {
  private frames: Array<{ pcm: Buffer; receivedAt: number }> = []
  private remainder: Buffer = Buffer.alloc(0)
  private receivedAt = 0

  constructor(private readonly maxQueueMs = MAX_QUEUE_MS) {}

  receive(pcm: Buffer, now: number) {
    const oldLength = this.frames.length
    this.frames = this.frames.filter(
      (frame) => now - frame.receivedAt < this.maxQueueMs,
    )
    const expired = oldLength !== this.frames.length
    const combined = Buffer.concat([
      now - this.receivedAt < 40 ? this.remainder : Buffer.alloc(0),
      pcm,
    ])
    let offset = 0
    for (; offset + PCM_FRAME_BYTES <= combined.length; offset += PCM_FRAME_BYTES) {
      this.frames.push({
        pcm: Buffer.from(combined.subarray(offset, offset + PCM_FRAME_BYTES)),
        receivedAt: now,
      })
    }
    const maxFrames = Math.max(1, Math.floor(this.maxQueueMs / 20))
    const overflow = this.frames.length > maxFrames
    this.frames = this.frames.slice(-maxFrames)
    this.remainder = Buffer.from(combined.subarray(offset))
    this.receivedAt = now
    return overflow || expired
  }

  take(now: number) {
    if (this.remainder.length && now - this.receivedAt >= 40) {
      if (now - this.receivedAt < this.maxQueueMs) {
        const padded = Buffer.alloc(PCM_FRAME_BYTES)
        this.remainder.copy(padded)
        this.frames.push({ pcm: padded, receivedAt: this.receivedAt })
      }
      this.remainder = Buffer.alloc(0)
    }
    while (this.frames[0] && now - this.frames[0].receivedAt >= this.maxQueueMs) {
      this.frames.shift()
    }
    return this.frames.shift()?.pcm ?? null
  }

  get empty() {
    return !this.frames.length && !this.remainder.length
  }
  clear() {
    this.frames = []
    this.remainder = Buffer.alloc(0)
  }
}
