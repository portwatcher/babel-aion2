import { performance } from 'node:perf_hooks'
import opus from '@discordjs/opus'
import { PcmTimeline } from './pcm-timeline.ts'

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const FRAME_SAMPLES = 960
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2
const FRAME_MS = 20
const MAX_QUEUE_MS = 100

/** Opus packet durations the playback branch may use. */
export const PACKET_DURATIONS = [20, 40, 60] as const
export type PacketDuration = (typeof PACKET_DURATIONS)[number]

/**
 * Receives independent speaker PCM. Only the playback branch is mixed. Mixing
 * runs every 20 ms; longer packets carry several mixed frames, so every listener
 * receives proportionally fewer packets to encrypt, relay and decode.
 */
export class RoomAudio {
  private readonly encoder = new opus.OpusEncoder(SAMPLE_RATE, CHANNELS)
  private readonly queues = new Map<string, PcmTimeline>()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false
  // Frames follow the monotonic clock. Interval callbacks drift late, so each
  // tick mixes every frame that is due rather than exactly one.
  private nextFrameAt = performance.now() + FRAME_MS
  private pending: Buffer[] = []

  constructor(
    private readonly allowed: () => boolean,
    private readonly publish: (packet: Buffer, durationMs: PacketDuration) => void,
    private readonly failed: () => void,
    private readonly packetMs: PacketDuration = 20,
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
    const timeline = this.queues.get(speakerId) ?? new PcmTimeline()
    timeline.receive(pcm, receivedAt)
    this.queues.set(speakerId, timeline)
  }

  remove(speakerId: string) {
    this.queues.delete(speakerId)
  }
  clear() {
    this.queues.clear()
    this.pending = []
  }

  private tick() {
    const now = performance.now()
    if (this.closed || !this.allowed() || now - this.nextFrameAt > MAX_QUEUE_MS) {
      // A stalled or unauthorized interval restarts from now without stale sound.
      this.clear()
      this.nextFrameAt = now + FRAME_MS
      return
    }
    while (now >= this.nextFrameAt && !this.closed) {
      this.nextFrameAt += FRAME_MS
      this.mix(now)
    }
  }

  private mix(now: number) {
    const frames: Buffer[] = []
    for (const [id, timeline] of this.queues) {
      const frame = timeline.take(now)
      if (frame) {
        frames.push(frame)
      }
      if (timeline.empty) {
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
    this.pending.push(mixed)
    if (this.pending.length < this.packetMs / FRAME_MS) {
      return
    }
    const packet = this.encoder.encode(Buffer.concat(this.pending))
    this.pending = []
    if (this.allowed()) {
      this.publish(Buffer.from(packet), this.packetMs)
    }
  }

  close() {
    this.closed = true
    clearInterval(this.timer)
    this.clear()
  }
}
