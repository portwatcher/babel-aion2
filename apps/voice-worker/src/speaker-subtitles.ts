import { performance } from 'node:perf_hooks'
import type { ProviderTestCode, SubtitleMessage } from '@babel/contracts'
import type { LiveSubtitlePath, SubtitlePathStamp } from '@babel/database/subtitles'
import {
  openSharedSubtitleStream,
  ProviderFailure,
  type SubtitleStreamEvent,
} from '@babel/providers'
import { PCM_FRAME_BYTES, PcmTimeline } from './pcm-timeline.ts'
import { SpeechTurns } from './speech-turns.ts'

export interface RunningSubtitlePath extends LiveSubtitlePath {
  key: string
  group: string
  version: number
}
export interface SubtitleConsumer {
  id: string
  outputLanguage: string
  deliver(
    event: SubtitleMessage,
    stamp?: SubtitlePathStamp,
    current?: () => boolean,
  ): void
}

/** One speaker and recognition configuration; all matching languages share its PCM. */
export class SpeakerSubtitles {
  private readonly stream: ReturnType<typeof openSharedSubtitleStream>
  private readonly timeline = new PcmTimeline()
  private readonly turns: SpeechTurns
  private readonly subscribers = new Map<
    string,
    { path: RunningSubtitlePath; remove: () => void }
  >()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly rotation: ReturnType<typeof setTimeout>
  private ready = false
  private closed = false
  private samples = 0
  private lastTick = performance.now()

  constructor(
    private readonly roomId: string,
    private readonly sourceGeneration: number,
    readonly streamGeneration: number,
    readonly speakerId: string,
    private readonly displayName: () => string,
    readonly group: string,
    path: RunningSubtitlePath,
    private readonly allowed: () => boolean,
    private readonly ended: (code: Exclude<ProviderTestCode, 'PASS'> | null) => void,
  ) {
    this.turns = new SpeechTurns(roomId)
    this.stream = openSharedSubtitleStream({
      recognition: path.recognition,
      sampleRate: 48_000,
      terminology: path.terminology,
    })
    this.timer = setInterval(() => this.tick(), 20)
    this.timer.unref()
    // Rotate before the provider session limit; the adapter also honors expires_at.
    this.rotation = setTimeout(() => this.finish(null), 50 * 60_000)
    this.rotation.unref()
    void this.stream.ready
      .then(() => {
        if (!this.closed) {
          this.timeline.clear()
          this.lastTick = performance.now()
          this.ready = true
        }
      })
      .catch((error: unknown) =>
        this.finish(error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'),
      )
    void this.stream.finished.catch((error: unknown) => {
      this.finish(error instanceof ProviderFailure ? error.code : 'UNAVAILABLE')
    })
  }

  state(
    consumer: SubtitleConsumer,
    state: 'CONNECTING' | 'WAITING' | 'UNAVAILABLE',
    failure: Exclude<ProviderTestCode, 'PASS'> | null = null,
  ) {
    consumer.deliver({
      type: 'subtitle-state',
      roomId: this.roomId,
      sourceGeneration: this.sourceGeneration,
      speakerId: this.speakerId,
      streamGeneration: this.streamGeneration,
      outputLanguage: consumer.outputLanguage,
      state,
      failure,
    })
  }

  reconcile(
    consumers: Iterable<SubtitleConsumer>,
    paths: Map<string, RunningSubtitlePath>,
  ) {
    const wanted = new Set<string>()
    for (const consumer of consumers) {
      const path = paths.get(consumer.outputLanguage)
      if (!path || path.group !== this.group) {
        continue
      }
      wanted.add(consumer.id)
      const previous = this.subscribers.get(consumer.id)
      if (previous?.path.key === path.key) {
        continue
      }
      previous?.remove()
      this.state(consumer, this.ready ? 'WAITING' : 'CONNECTING')
      const current = () =>
        !this.closed &&
        this.allowed() &&
        this.subscribers.get(consumer.id)?.path.key === path.key
      try {
        const remove = this.stream.subscribe(
          {
            outputLanguage: path.stamp.code,
            settings: path.translation.settings,
            credential: path.translation.credential,
            version: path.version,
          },
          (event) => this.deliver(consumer, path, event, current),
        )
        this.subscribers.set(consumer.id, { path, remove })
      } catch (error) {
        this.subscribers.delete(consumer.id)
        this.state(
          consumer,
          'UNAVAILABLE',
          error instanceof ProviderFailure ? error.code : 'UNAVAILABLE',
        )
      }
    }
    for (const [id, subscriber] of this.subscribers) {
      if (!wanted.has(id)) {
        subscriber.remove()
        this.subscribers.delete(id)
      }
    }
  }

  private deliver(
    consumer: SubtitleConsumer,
    path: RunningSubtitlePath,
    event: SubtitleStreamEvent,
    current: () => boolean,
  ) {
    if (!current()) {
      return
    }
    if (event.type !== 'subtitle') {
      this.state(
        consumer,
        event.type === 'failure' ? 'UNAVAILABLE' : 'WAITING',
        event.type === 'failure' ? event.code : null,
      )
      return
    }
    const value = event.value
    const latency = this.turns.fragment(
      value.outputLanguage,
      value.translatedText.trim()
        ? `${value.utteranceId}:${value.translationRevision}`
        : null,
    )
    consumer.deliver(
      {
        type: 'subtitle',
        value: {
          roomId: this.roomId,
          sourceGeneration: this.sourceGeneration,
          streamGeneration: this.streamGeneration,
          speakerId: this.speakerId,
          speakerDisplayName: this.displayName(),
          utteranceId: value.utteranceId,
          sourceRevision: value.revision,
          translationRevision: value.translationRevision,
          sequence: value.sequence,
          sourceLanguage: value.language,
          originalText: value.text,
          outputLanguage: value.outputLanguage,
          translatedText: value.translatedText,
          sourceIsFinal: value.isFinal,
          translationIsFinal: value.translationIsFinal,
          configurationVersion: value.configurationVersion,
          sourceAlignment: value.sourceAlignment,
          audioStartMs: value.audioStartMs,
          audioEndMs: value.audioEndMs,
          serverSentAt: new Date().toISOString(),
          discontinuity: value.discontinuity,
          failure: value.failure,
          latency,
        },
      },
      path.stamp,
      current,
    )
  }

  receive(pcm: Buffer) {
    if (this.closed || pcm.length % 4) {
      return
    }
    this.turns.hear(pcm)
    const overflow = this.timeline.receive(pcm, performance.now())
    if (overflow && this.ready) {
      this.finish('UNAVAILABLE')
    }
  }

  private tick() {
    if (this.closed || !this.ready) {
      return
    }
    const now = performance.now()
    if (!this.allowed() || now - this.lastTick > 100) {
      // A new stream gets a fresh generation; dropped time is never spliced into speech.
      this.finish('UNAVAILABLE')
      return
    }
    this.lastTick = now
    const frame = this.timeline.take(now) ?? Buffer.alloc(PCM_FRAME_BYTES)
    const mono = Buffer.alloc(960 * 2)
    for (let i = 0; i < 960; i += 1) {
      mono.writeInt16LE(
        Math.round((frame.readInt16LE(i * 4) + frame.readInt16LE(i * 4 + 2)) / 2),
        i * 2,
      )
    }
    try {
      this.stream.write(mono, this.samples)
      this.samples += 960
    } catch (error) {
      this.finish(error instanceof ProviderFailure ? error.code : 'UNAVAILABLE')
    }
  }

  private finish(code: Exclude<ProviderTestCode, 'PASS'> | null) {
    if (this.closed) {
      return
    }
    this.close()
    this.ended(code)
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    clearTimeout(this.rotation)
    this.timeline.clear()
    this.turns.close()
    for (const subscriber of this.subscribers.values()) {
      subscriber.remove()
    }
    this.subscribers.clear()
    this.stream.close()
  }
}
