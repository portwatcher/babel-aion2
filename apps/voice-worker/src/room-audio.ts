import { performance } from 'node:perf_hooks'
import opus from '@discordjs/opus'

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const FRAME_SAMPLES = 960
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2
const FRAME_MS = 20
const MAX_QUEUE_MS = 100
interface Frame {
  pcm: Buffer
  receivedAt: number
}
interface Timeline {
  frames: Frame[]
  remainder: Buffer
  receivedAt: number
}

/** Receives independent speaker PCM. Only the playback branch is mixed. */
export class RoomAudio {
  private readonly encoder = new opus.OpusEncoder(SAMPLE_RATE, CHANNELS)
  private readonly queues = new Map<string, Timeline>()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false
  private lastTick = performance.now()

  constructor(
    private readonly allowed: () => boolean,
    private readonly publish: (packet: Buffer) => void,
    private readonly failed: () => void,
  ) {
    this.encoder.setBitrate(96_000)
    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch {
        this.close()
        this.failed()
      }
    }, FRAME_MS)
    this.timer.unref()
  }

  receive(speakerId: string, pcm: Buffer) {
    if (this.closed || !this.allowed() || pcm.length % (CHANNELS * 2) !== 0) {
      return
    }
    const receivedAt = performance.now()
    const prior = this.queues.get(speakerId)
    // Never concatenate speech separated by a real pause, or replay a backlog
    // accumulated while the process was stalled.
    const queue =
      prior?.frames.filter((frame) => receivedAt - frame.receivedAt < MAX_QUEUE_MS) ??
      []
    const remainder =
      prior && receivedAt - prior.receivedAt < 40 ? prior.remainder : Buffer.alloc(0)
    const combined = Buffer.concat([remainder, pcm])
    let offset = 0
    for (; offset + FRAME_BYTES <= combined.length; offset += FRAME_BYTES) {
      queue.push({
        pcm: Buffer.from(combined.subarray(offset, offset + FRAME_BYTES)),
        receivedAt,
      })
    }
    while (queue.length * FRAME_MS > MAX_QUEUE_MS) {
      queue.shift()
    }
    this.queues.set(speakerId, {
      frames: queue,
      remainder: Buffer.from(combined.subarray(offset)),
      receivedAt,
    })
  }

  remove(speakerId: string) {
    this.queues.delete(speakerId)
  }
  clear() {
    this.queues.clear()
  }

  private tick() {
    const now = performance.now()
    if (this.closed || !this.allowed() || now - this.lastTick > MAX_QUEUE_MS) {
      this.clear()
      this.lastTick = now
      return
    }
    this.lastTick = now
    const frames: Buffer[] = []
    for (const [id, timeline] of this.queues) {
      const queue = timeline.frames
      if (timeline.remainder.length && now - timeline.receivedAt >= 40) {
        if (now - timeline.receivedAt < MAX_QUEUE_MS) {
          const padded = Buffer.alloc(FRAME_BYTES)
          timeline.remainder.copy(padded)
          queue.push({ pcm: padded, receivedAt: timeline.receivedAt })
        }
        timeline.remainder = Buffer.alloc(0)
      }
      while (queue[0] && now - queue[0].receivedAt >= MAX_QUEUE_MS) {
        queue.shift()
      }
      const frame = queue.shift()
      if (frame) {
        frames.push(frame.pcm)
      }
      if (!queue.length && !timeline.remainder.length) {
        this.queues.delete(id)
      }
    }
    const mixed = Buffer.alloc(FRAME_BYTES)
    if (frames.length) {
      for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
        let sum = 0
        for (const frame of frames) {
          sum += frame.readInt16LE(offset)
        }
        mixed.writeInt16LE(Math.round(sum / frames.length), offset)
      }
    }
    // Explicit silence preserves pauses on the same 48 kHz media timeline.
    const packet = this.encoder.encode(mixed)
    if (this.allowed()) {
      this.publish(Buffer.from(packet))
    }
  }

  close() {
    this.closed = true
    clearInterval(this.timer)
    this.clear()
  }
}
